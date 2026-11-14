import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from './dynamodb-client';

const docClient = DynamoDBDocumentClient.from(createDynamoDBClient());

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
    const tableName = process.env.BOOKINGS_TABLE_NAME;
    if (!tableName) {
        throw new Error('BOOKINGS_TABLE_NAME is not configured.');
    }

    const bookingMap = new Map<string, {
        movieTitle?: string;
        date?: string;
        time?: string;
        screen?: string;
        seats: string[];
        bookingRef?: string;
        movieId?: string;
        customerName?: string;
        totalAmount?: number;
        currency?: string;
    }>();

    // Query SEAT records by userId
    let exclusiveStartKey: Record<string, unknown> | undefined;
    do {
        const result = await docClient.send(new QueryCommand({
            TableName: tableName,
            IndexName: 'UserBookings',
            KeyConditionExpression: 'userId = :userId',
            FilterExpression: 'recordType = :seat',
            ExpressionAttributeValues: { ':userId': userId, ':seat': 'SEAT' },
            ExclusiveStartKey: exclusiveStartKey,
        }));

        for (const item of result.Items ?? []) {
            if (typeof item.bookingId !== 'string' || !item.bookingId) continue;

            if (!bookingMap.has(item.bookingId)) {
                bookingMap.set(item.bookingId, { seats: [] });
            }

            const booking = bookingMap.get(item.bookingId)!;
            if (typeof item.seatId === 'string') {
                booking.seats.push(item.seatId);
            }
            if (typeof item.movieTitle === 'string') booking.movieTitle = item.movieTitle;
            if (typeof item.date === 'string') booking.date = item.date;
            if (typeof item.time === 'string') booking.time = item.time;
            if (typeof item.screen === 'string') booking.screen = item.screen;
            if (typeof item.movieId === 'string') booking.movieId = item.movieId;
        }

        exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);

    // Also query BOOKING records (for guest bookings)
    exclusiveStartKey = undefined;
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
            if (typeof item.bookingId !== 'string' || !item.bookingId) continue;

            if (!bookingMap.has(item.bookingId)) {
                bookingMap.set(item.bookingId, { seats: [] });
            }

            const booking = bookingMap.get(item.bookingId)!;
            if (typeof item.movieTitle === 'string') booking.movieTitle = item.movieTitle;
            if (typeof item.date === 'string') booking.date = item.date;
            if (typeof item.time === 'string') booking.time = item.time;
            if (typeof item.screen === 'string') booking.screen = item.screen;
            if (typeof item.movieId === 'string') booking.movieId = item.movieId;
            if (typeof item.bookingRef === 'string') booking.bookingRef = item.bookingRef;
            if (typeof item.customerName === 'string') booking.customerName = item.customerName;
            if (typeof item.totalAmount === 'number') booking.totalAmount = item.totalAmount;
            if (typeof item.currency === 'string') booking.currency = item.currency;
            // For BOOKING records, the seats are already in an array in the record
            if (Array.isArray(item.seats) && booking.seats.length === 0) {
                booking.seats = item.seats;
            }
        }

        exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);

    // Validate and transform to output format
    const bookings = [];
    for (const [bookingId, booking] of bookingMap) {
        const date = typeof booking.date === 'string'
            ? new Date(`${booking.date}T00:00:00Z`)
            : new Date(NaN);

        if (typeof booking.movieTitle !== 'string' || !booking.movieTitle
            || typeof booking.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(booking.date)
            || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== booking.date
            || typeof booking.time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(booking.time)
            || typeof booking.screen !== 'string' || !booking.screen
            || !booking.seats.length) {
            // Skip invalid bookings
            continue;
        }

        // Calculate ticket count from seats
        const ticketCount = booking.seats.length;

        bookings.push({
            bookingId,
            ...(booking.bookingRef !== undefined && { bookingRef: booking.bookingRef }),
            ...(booking.movieId !== undefined && { movieId: booking.movieId }),
            movieTitle: booking.movieTitle,
            date: booking.date,
            time: booking.time,
            screen: booking.screen,
            seats: booking.seats.sort(),
            ...(booking.customerName !== undefined && { guestName: booking.customerName }),
            ticketCount,
            ...(booking.totalAmount !== undefined && { totalAmount: booking.totalAmount }),
            ...(booking.currency !== undefined && { currency: booking.currency }),
        });
    }

    return bookings;
}
