import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from './dynamodb-client';
import { json, log } from './utils/common';
import { generateTicketPdf, type TicketPdfInput } from './utils/ticket-pdf-generator';

const docClient = DynamoDBDocumentClient.from(createDynamoDBClient());

class TicketDataError extends Error {}

async function findOwnedBooking(
    userId: string,
    bookingId: string
): Promise<Record<string, unknown> | undefined> {
    const tables = [
        { name: process.env.BOOKINGS_TABLE_NAME, partitionKey: 'showtimeId' },
        { name: process.env.LEGACY_BOOKINGS_TABLE_NAME, partitionKey: 'showingId' },
    ] as const;
    if (tables.some((table) => !table.name)) {
        throw new Error('Booking tables are not configured.');
    }

    for (const table of tables) {
        let exclusiveStartKey: Record<string, unknown> | undefined;
        do {
            const result = await docClient.send(new QueryCommand({
                TableName: table.name,
                IndexName: 'UserBookings',
                KeyConditionExpression: '#userId = :userId',
                FilterExpression: '#recordType = :booking AND #bookingId = :bookingId',
                ProjectionExpression: '#partitionKey, #seatId',
                ExpressionAttributeNames: {
                    '#userId': 'userId',
                    '#recordType': 'recordType',
                    '#bookingId': 'bookingId',
                    '#partitionKey': table.partitionKey,
                    '#seatId': 'seatId',
                },
                ExpressionAttributeValues: {
                    ':userId': userId,
                    ':booking': 'BOOKING',
                    ':bookingId': bookingId,
                },
                ExclusiveStartKey: exclusiveStartKey,
            }));

            for (const item of result.Items ?? []) {
                const partitionValue = item[table.partitionKey];
                if (typeof partitionValue !== 'string' || !partitionValue
                    || item.seatId !== `BOOKING#${bookingId}`) {
                    throw new TicketDataError('The booking index contains invalid booking keys.');
                }
                // Recheck ownership on the base table because the index is eventually consistent.
                const booking = await docClient.send(new GetCommand({
                    TableName: table.name,
                    Key: { [table.partitionKey]: partitionValue, seatId: item.seatId },
                    ConsistentRead: true,
                }));
                if (booking.Item?.userId === userId
                    && booking.Item.recordType === 'BOOKING'
                    && booking.Item.bookingId === bookingId) {
                    return booking.Item;
                }
            }
            exclusiveStartKey = result.LastEvaluatedKey;
        } while (exclusiveStartKey);
    }
    return undefined;
}

function ticketDetails(booking: Record<string, unknown>): TicketPdfInput {
    const { bookingRef, movieTitle, date, time, screen, seats, customerName, tickets, totalAmount, currency } = booking;
    const parsedDate = typeof date === 'string' ? new Date(`${date}T00:00:00Z`) : new Date(NaN);
    if (typeof bookingRef !== 'string' || !bookingRef.trim()
        || typeof movieTitle !== 'string' || !movieTitle.trim()
        || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)
        || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date
        || typeof time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)
        || typeof screen !== 'string' || !screen.trim()
        || !Array.isArray(seats) || seats.length === 0
        || seats.some((seat: unknown) => typeof seat !== 'string' || !seat.trim())
        || new Set(seats).size !== seats.length
        || typeof customerName !== 'string' || !customerName.trim()
        || !Array.isArray(tickets) || tickets.length === 0
        || typeof totalAmount !== 'number' || !Number.isFinite(totalAmount) || totalAmount < 0
        || typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) {
        throw new TicketDataError('The booking contains invalid ticket details.');
    }

    let ticketCount = 0;
    for (const ticket of tickets as unknown[]) {
        if (typeof ticket !== 'object' || ticket === null || !('quantity' in ticket)
            || typeof ticket.quantity !== 'number'
            || !Number.isSafeInteger(ticket.quantity) || ticket.quantity < 1) {
            throw new TicketDataError('The booking contains invalid ticket quantities.');
        }
        ticketCount += ticket.quantity;
    }
    if (!Number.isSafeInteger(ticketCount) || ticketCount !== seats.length) {
        throw new TicketDataError('The booking ticket quantities do not match its seats.');
    }

    return {
        bookingRef, movieTitle, date, time, screen, seats,
        guestName: customerName, ticketCount, totalAmount, currency,
    };
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
    const userId = event.requestContext.authorizer?.jwt?.claims?.sub;
    if (typeof userId !== 'string' || !userId.trim()) {
        return json(401, { message: 'A valid Cognito user is required.' });
    }
    const bookingId = event.pathParameters?.bookingId;
    if (!bookingId?.trim()) {
        return json(400, { message: 'A booking ID is required.' });
    }

    try {
        const booking = await findOwnedBooking(userId, bookingId);
        if (!booking) return json(404, { message: 'Booking not found.' });
        const details = ticketDetails(booking);
        const pdf = await generateTicketPdf(details);
        return {
            statusCode: 200,
            isBase64Encoded: true,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="${details.bookingRef.replace(/[^a-zA-Z0-9_-]/g, '-')}.pdf"`,
                'Content-Length': String(pdf.length),
                'Cache-Control': 'no-store',
            },
            body: pdf.toString('base64'),
        };
    } catch (error: unknown) {
        log('ERROR', 'Failed to download booking ticket', {
            requestId: event.requestContext.requestId,
            errorName: error instanceof Error ? error.name : 'UnknownError',
            ...(error instanceof TicketDataError && { reason: error.message }),
        });
        return json(500, { message: 'Unable to download booking ticket.' });
    }
}
