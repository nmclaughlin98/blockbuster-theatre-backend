import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from './dynamodb-client';

const docClient = DynamoDBDocumentClient.from(createDynamoDBClient());

export async function listAccountBookings(userId: string): Promise<Array<{
    bookingId: string;
    bookingRef?: string;
    movieTitle: string;
    date: string;
    time: string;
    screen: string;
    seats: string[];
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
                    || typeof item.movieTitle !== 'string' || !item.movieTitle
                    || typeof item.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)
                    || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== item.date
                    || typeof item.time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item.time)
                    || typeof item.screen !== 'string' || !item.screen
                    || !Array.isArray(item.seats)
                    || item.seats.some((seat: unknown) => typeof seat !== 'string')) {
                    throw new Error('The booking table contains invalid account booking details.');
                }
                bookings.push({
                    bookingId: item.bookingId,
                    ...(item.bookingRef !== undefined && { bookingRef: item.bookingRef }),
                    movieTitle: item.movieTitle,
                    date: item.date,
                    time: item.time,
                    screen: item.screen,
                    seats: item.seats as string[],
                });
            }
            exclusiveStartKey = result.LastEvaluatedKey;
        } while (exclusiveStartKey);
    }
    return bookings;
}
