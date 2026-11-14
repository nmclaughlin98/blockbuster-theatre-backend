import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from './dynamodb-client';

const docClient = DynamoDBDocumentClient.from(createDynamoDBClient());

function hasValidQuantity(ticket: unknown): ticket is { quantity: number } {
    return typeof ticket === 'object' && ticket !== null && 'quantity' in ticket
        && typeof ticket.quantity === 'number'
        && Number.isSafeInteger(ticket.quantity) && ticket.quantity > 0;
}

export async function listAccountBookings(userId: string): Promise<Array<{
    bookingId: string;
    bookingRef?: string;
    movieId?: string;
    movieTitle: string;
    date: string;
    time: string;
    screen: string;
    seats: string[];
    guestName?: string;
    ticketCount?: number;
    totalAmount?: number;
    currency?: string;
}>> {
    const tableNames = [process.env.BOOKINGS_TABLE_NAME, process.env.LEGACY_BOOKINGS_TABLE_NAME];
    if (tableNames.some((name) => !name)) {
        throw new Error('Booking tables are not configured.');
    }

    const bookings = [];
    for (const tableName of tableNames) {
        let exclusiveStartKey: Record<string, unknown> | undefined;
        do {
            const result = await docClient.send(new QueryCommand({
                TableName: tableName,
                IndexName: 'UserBookings',
                KeyConditionExpression: 'userId = :userId',
                FilterExpression: 'recordType = :booking',
                ExpressionAttributeValues: { ':userId': userId, ':booking': 'BOOKING' },
                ExclusiveStartKey: exclusiveStartKey,
            }));
            for (const item of result.Items ?? []) {
                const date = typeof item.date === 'string'
                    ? new Date(`${item.date}T00:00:00Z`)
                    : new Date(NaN);
                if (typeof item.bookingId !== 'string' || !item.bookingId
                    || (item.bookingRef !== undefined
                        && (typeof item.bookingRef !== 'string' || !item.bookingRef))
                    || (item.movieId !== undefined
                        && (typeof item.movieId !== 'string' || !/^\d+$/.test(item.movieId)))
                    || typeof item.movieTitle !== 'string' || !item.movieTitle
                    || typeof item.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)
                    || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== item.date
                    || typeof item.time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item.time)
                    || typeof item.screen !== 'string' || !item.screen
                    || !Array.isArray(item.seats)
                    || item.seats.some((seat: unknown) => typeof seat !== 'string')
                    || (item.customerName !== undefined
                        && (typeof item.customerName !== 'string' || !item.customerName.trim()))
                    || (item.totalAmount !== undefined
                        && (typeof item.totalAmount !== 'number'
                            || !Number.isFinite(item.totalAmount) || item.totalAmount < 0))
                    || (item.currency !== undefined
                        && (typeof item.currency !== 'string' || !/^[A-Z]{3}$/.test(item.currency)))) {
                    throw new Error('The booking table contains invalid account booking details.');
                }
                let ticketCount: number | undefined;
                if (item.tickets !== undefined) {
                    const tickets: unknown = item.tickets;
                    if (!Array.isArray(tickets) || !tickets.length || !tickets.every(hasValidQuantity)) {
                        throw new Error('The booking table contains invalid account ticket details.');
                    }
                    ticketCount = tickets.reduce((sum, ticket) => sum + ticket.quantity, 0);
                    if (!Number.isSafeInteger(ticketCount) || ticketCount !== item.seats.length) {
                        throw new Error('The booking table contains invalid account ticket details.');
                    }
                }
                bookings.push({
                    bookingId: item.bookingId,
                    ...(item.bookingRef !== undefined && { bookingRef: item.bookingRef }),
                    ...(item.movieId !== undefined && { movieId: item.movieId }),
                    movieTitle: item.movieTitle,
                    date: item.date,
                    time: item.time,
                    screen: item.screen,
                    seats: item.seats as string[],
                    ...(item.customerName !== undefined && { guestName: item.customerName }),
                    ...(ticketCount !== undefined && { ticketCount }),
                    ...(item.totalAmount !== undefined && { totalAmount: item.totalAmount }),
                    ...(item.currency !== undefined && { currency: item.currency }),
                });
            }
            exclusiveStartKey = result.LastEvaluatedKey;
        } while (exclusiveStartKey);
    }
    return bookings;
}
