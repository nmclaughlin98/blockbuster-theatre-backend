import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand, type QueryCommandOutput } from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from '../Shared/dynamodb-client';
import { log } from '../utils/common';

const docClient = DynamoDBDocumentClient.from(createDynamoDBClient());
const sesClient = new SESv2Client({});

export interface LinkedBooking {
    bookingId: string;
    bookingRef: string;
    movieTitle: string;
    date: string;
    time: string;
    [key: string]: unknown;
}

export interface GuestLinkResult {
    bookings: LinkedBooking[];
    notificationSent: boolean;
}

function isLinkedBooking(item: Record<string, unknown>, partitionKey: string): item is LinkedBooking {
    const date = typeof item.date === 'string' ? new Date(`${item.date}T00:00:00Z`) : new Date(NaN);
    return typeof item[partitionKey] === 'string'
        && typeof item.bookingId === 'string' && item.bookingId.length > 0
        && item.seatId === `BOOKING#${item.bookingId}`
        && typeof item.bookingRef === 'string' && item.bookingRef.length > 0
        && typeof item.movieTitle === 'string' && item.movieTitle.length > 0
        && typeof item.bookedAt === 'string' && item.bookedAt.length > 0
        && typeof item.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.date)
        && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === item.date
        && typeof item.time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item.time)
        && typeof item.screen === 'string' && item.screen.length > 0
        && Array.isArray(item.seats) && item.seats.length > 0
        && item.seats.every((seat: unknown) => typeof seat === 'string' && seat.length > 0);
}

export async function linkGuestBookings(userId: string, email: string): Promise<GuestLinkResult> {
    const tables = [
        { name: process.env.BOOKINGS_TABLE_NAME, key: 'showtimeId' },
        { name: process.env.LEGACY_BOOKINGS_TABLE_NAME, key: 'showingId' },
    ] as const;
    if (tables.some((table) => !table.name)) throw new Error('Booking tables are not configured.');

    const candidates: Array<{ table: typeof tables[number]; item: LinkedBooking }> = [];
    for (const table of tables) {
        let exclusiveStartKey: Record<string, unknown> | undefined;
        do {
            const page: QueryCommandOutput = await docClient.send(new QueryCommand({
                TableName: table.name,
                IndexName: 'CustomerEmailBookings',
                KeyConditionExpression: 'customerEmail = :email',
                FilterExpression: 'recordType = :booking AND (attribute_not_exists(userId) OR userId = :null)',
                ExpressionAttributeValues: { ':email': email, ':booking': 'BOOKING', ':null': null },
                ExclusiveStartKey: exclusiveStartKey,
            }));
            for (const item of page.Items ?? []) {
                if (!isLinkedBooking(item, table.key)) {
                    throw new Error('Guest booking contains invalid linking details.');
                }
                candidates.push({ table, item });
            }
            exclusiveStartKey = page.LastEvaluatedKey;
        } while (exclusiveStartKey);
    }

    const linked: LinkedBooking[] = [];
    let notificationSent = true;
    try {
        for (const { table, item } of candidates) {
            try {
                const result = await docClient.send(new UpdateCommand({
                    TableName: table.name,
                    Key: { [table.key]: item[table.key], seatId: item.seatId },
                    UpdateExpression: 'SET userId = :userId, claimedAt = :claimedAt, claimMethod = :method REMOVE conversionTokenHash, guestAccessToken',
                    ConditionExpression: 'recordType = :booking AND bookingId = :bookingId AND customerEmail = :email AND (attribute_not_exists(userId) OR userId = :null)',
                    ExpressionAttributeValues: {
                        ':userId': userId,
                        ':claimedAt': new Date().toISOString(),
                        ':method': 'AUTO_EMAIL_MATCH',
                        ':booking': 'BOOKING',
                        ':bookingId': item.bookingId,
                        ':email': email,
                        ':null': null,
                    },
                    ReturnValues: 'ALL_NEW',
                }));
                linked.push(item);
                if (!result.Attributes || !isLinkedBooking(result.Attributes, table.key)) {
                    throw new Error('Updated guest booking contains invalid linking details.');
                }
                linked[linked.length - 1] = result.Attributes;
            } catch (error: unknown) {
                if (!(error instanceof Error) || error.name !== 'ConditionalCheckFailedException') throw error;
            }
        }
    } finally {
        if (linked.length) {
            try {
                const source = process.env.BOOKING_EMAIL_FROM;
                if (!source) throw new Error('BOOKING_EMAIL_FROM is not configured.');
                await sesClient.send(new SendEmailCommand({
                    FromEmailAddress: source,
                    Destination: { ToAddresses: [email] },
                    Content: { Simple: {
                        Subject: { Data: "We've linked your guest booking(s) to your Blockbuster Theatre account" },
                        Body: { Text: { Data: [
                            'Because you checked out using your account email address, these bookings have been automatically added to your account:',
                            '',
                            ...linked.map((booking) => `${booking.bookingRef} - ${booking.movieTitle} - ${booking.date} ${booking.time}`),
                            '',
                            'Your previous guest conversion link has been disabled for security.',
                        ].join('\n') } },
                    } },
                }));
            } catch (error: unknown) {
                notificationSent = false;
                log('ERROR', 'Guest bookings linked but notification email failed', {
                    errorName: error instanceof Error ? error.name : 'UnknownError',
                    bookingCount: linked.length,
                });
            }
        }
    }
    return { bookings: linked, notificationSent };
}
