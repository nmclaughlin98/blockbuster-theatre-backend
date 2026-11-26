import { DynamoDBDocumentClient, QueryCommand, type QueryCommandOutput } from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from '../../main/lambda/handlers/Shared/dynamodb-client';
import type { LinkedBooking } from './link-guest-bookings';

const docClient = DynamoDBDocumentClient.from(createDynamoDBClient());

export async function listAccountBookings(
    userId: string,
    newlyLinked: LinkedBooking[] = [],
): Promise<
    Array<{
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
    }>
> {
    const tableName = process.env.BOOKINGS_TABLE_NAME;
    if (!tableName) {
        throw new Error('Booking table is not configured.');
    }

    const bookingMap = new Map<
        string,
        {
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
        }
    >();

    let exclusiveStartKey: Record<string, unknown> | undefined;
    do {
        const result: QueryCommandOutput = await docClient.send(new QueryCommand({
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

    function addBooking(item: Record<string, unknown>) {
        if (typeof item.bookingId !== 'string' || !item.bookingId) {
            throw new Error('DynamoDB returned a booking without an ID.');
        }
        if ((item.movieId !== undefined && (typeof item.movieId !== 'string' || !/^\d+$/.test(item.movieId)))
            || (item.customerName !== undefined && (typeof item.customerName !== 'string' || !item.customerName.trim()))
            || (item.totalAmount !== undefined && (typeof item.totalAmount !== 'number'
                || !Number.isFinite(item.totalAmount) || item.totalAmount < 0))
            || (item.currency !== undefined && (typeof item.currency !== 'string' || !/^[A-Z]{3}$/.test(item.currency)))
            || (item.seats !== undefined && (!Array.isArray(item.seats)
                || item.seats.some((seat: unknown) => typeof seat !== 'string' || !seat.trim())
                || new Set(item.seats).size !== item.seats.length))) {
            throw new Error('DynamoDB returned invalid booking details.');
        }
        if (item.tickets !== undefined) {
            if (!Array.isArray(item.tickets) || !Array.isArray(item.seats)
                || item.tickets.some((ticket: unknown) => typeof ticket !== 'object' || ticket === null
                    || !('quantity' in ticket) || typeof ticket.quantity !== 'number'
                    || !Number.isSafeInteger(ticket.quantity) || ticket.quantity < 1)
                || item.tickets.reduce((sum: number, ticket: { quantity: number }) => sum + ticket.quantity, 0) !== item.seats.length) {
                throw new Error('DynamoDB returned invalid booking tickets.');
            }
        }

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

        if (Array.isArray(item.seats) && booking.seats.length === 0) {
            booking.seats = item.seats;
        }
    }

    for (const item of newlyLinked) addBooking(item);
    do {
            const result: QueryCommandOutput = await docClient.send(new QueryCommand({
                TableName: tableName,
                    IndexName: 'UserBookings',
                    KeyConditionExpression: 'userId = :userId',
                    FilterExpression: 'recordType = :booking',
                    ExpressionAttributeValues: { ':userId': userId, ':booking': 'BOOKING' },
                    ExclusiveStartKey: exclusiveStartKey,
                }),
            );
            for (const item of result.Items ?? []) addBooking(item);

            exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);

    // Validate and transform to output format
    const bookings = [];

    for (const [bookingId, booking] of bookingMap) {
        const date = typeof booking.date === 'string' ? new Date(`${booking.date}T00:00:00Z`) : new Date(NaN);

        if (
            typeof booking.movieTitle !== 'string' ||
            !booking.movieTitle ||
            typeof booking.date !== 'string' ||
            !/^\d{4}-\d{2}-\d{2}$/.test(booking.date) ||
            Number.isNaN(date.getTime()) ||
            date.toISOString().slice(0, 10) !== booking.date ||
            typeof booking.time !== 'string' ||
            !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(booking.time) ||
            typeof booking.screen !== 'string' ||
            !booking.screen ||
            !booking.seats.length
        ) {
            throw new Error('DynamoDB returned an invalid booking.');
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
