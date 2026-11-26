import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
    DynamoDBDocumentClient,
    QueryCommand,
    TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from '../Shared/dynamodb-client';
import { json, log } from '../utils/common';

const docClient = DynamoDBDocumentClient.from(createDynamoDBClient());
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const SHOWTIME_ID_PATTERN = /^\d{6}_(\d{4}-\d{2}-\d{2})_((?:[01]\d|2[0-3])[0-5]\d)$/;

type UnknownRecord = Record<string, unknown>;

class RescheduleRequestError extends Error {
    constructor(public readonly statusCode: number, message: string) {
        super(message);
        this.name = 'RescheduleRequestError';
    }
}

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseDate(value: unknown): string {
    const match = typeof value === 'string' ? DATE_PATTERN.exec(value) : null;
    if (!match) {
        throw new RescheduleRequestError(400, 'date must use YYYY-MM-DD format.');
    }
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    if (date.toISOString().slice(0, 10) !== value) {
        throw new RescheduleRequestError(400, 'date must be a valid calendar date.');
    }
    return value;
}

function weekdayForDate(date: string): string {
    return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
        weekday: 'long',
        timeZone: 'UTC',
    });
}

function showtimeDetails(showtimeId: string): { date: string; time: string } | undefined {
    const match = SHOWTIME_ID_PATTERN.exec(showtimeId);
    if (!match) return undefined;
    return {
        date: match[1],
        time: `${match[2].slice(0, 2)}:${match[2].slice(2)}`,
    };
}

function parseRequest(body: unknown): {
    newShowtimeId: string;
    date?: string;
    time?: string;
    screen?: string;
} {
    if (!isRecord(body)) {
        throw new RescheduleRequestError(400, 'Request body must be a JSON object.');
    }
    const { newShowtimeId, date, time, screen } = body;
    if (typeof newShowtimeId !== 'string' || !newShowtimeId.trim()) {
        throw new RescheduleRequestError(400, 'newShowtimeId is required.');
    }
    const parsedDate = date === undefined ? undefined : parseDate(date);
    if (time !== undefined && (typeof time !== 'string' || !TIME_PATTERN.test(time))) {
        throw new RescheduleRequestError(400, 'time must use HH:MM format.');
    }
    if (screen !== undefined && (typeof screen !== 'string' || !screen.trim())) {
        throw new RescheduleRequestError(400, 'screen must be a non-empty string.');
    }
    return {
        newShowtimeId: newShowtimeId.trim(),
        ...(parsedDate !== undefined && { date: parsedDate }),
        ...(typeof time === 'string' && { time }),
        ...(typeof screen === 'string' && { screen }),
    };
}

function requiredBookingsTableName(): string {
    const tableName = process.env.BOOKINGS_TABLE_NAME;
    if (!tableName) throw new Error('BOOKINGS_TABLE_NAME is not configured.');
    return tableName;
}

function requiredShowtimeRegistryTableName(): string {
    const tableName = process.env.SHOWTIME_REGISTRY_TABLE_NAME;
    if (!tableName) throw new Error('SHOWTIME_REGISTRY_TABLE_NAME is not configured.');
    return tableName;
}

async function findBooking(
    tableName: string,
    showtimeId: string,
    bookingRef: string
): Promise<UnknownRecord | undefined> {
    let exclusiveStartKey: Record<string, unknown> | undefined;
    do {
        const result = await docClient.send(new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: '#showtimeId = :showtimeId AND begins_with(#seatId, :bookingPrefix)',
            FilterExpression: '#bookingRef = :bookingRef',
            ExpressionAttributeNames: {
                '#showtimeId': 'showtimeId',
                '#seatId': 'seatId',
                '#bookingRef': 'bookingRef',
            },
            ExpressionAttributeValues: {
                ':showtimeId': showtimeId,
                ':bookingPrefix': 'BOOKING#',
                ':bookingRef': bookingRef,
            },
            ConsistentRead: true,
            ExclusiveStartKey: exclusiveStartKey,
        }));
        const booking = (result.Items ?? []).find((item) => item.recordType === 'BOOKING');
        if (booking) return booking;
        exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);
    return undefined;
}

function bookingFields(booking: UnknownRecord): {
    bookingId: string;
    seats: string[];
    bookedAt: string;
    movieId: string;
    screen: string;
    userId: string;
} {
    const { bookingId, seats, bookedAt, movieId, screen, userId } = booking;
    if (
        typeof bookingId !== 'string' || !bookingId
        || booking.seatId !== `BOOKING#${bookingId}`
        || !Array.isArray(seats) || seats.length === 0
        || seats.some((seat: unknown) => typeof seat !== 'string' || !seat)
        || new Set(seats).size !== seats.length
        || typeof bookedAt !== 'string' || !bookedAt
        || typeof movieId !== 'string' || !movieId
        || typeof screen !== 'string' || !screen
        || typeof userId !== 'string' || !userId
    ) {
        throw new Error('The stored booking record is invalid.');
    }
    return { bookingId, seats: seats as string[], bookedAt, movieId, screen, userId };
}

async function rescheduleBooking(
    oldShowtimeId: string,
    bookingRef: string,
    request: ReturnType<typeof parseRequest>
): Promise<UnknownRecord> {
    if (request.newShowtimeId === oldShowtimeId) {
        throw new RescheduleRequestError(400, 'newShowtimeId must differ from showtimeId.');
    }

    const tableName = requiredBookingsTableName();
    const registryTableName = requiredShowtimeRegistryTableName();
    const booking = await findBooking(tableName, oldShowtimeId, bookingRef);
    if (!booking) throw new RescheduleRequestError(404, 'Booking not found.');

    const {
        bookingId,
        seats,
        bookedAt,
        movieId,
        screen: currentScreen,
        userId,
    } = bookingFields(booking);
    const parsedShowtime = showtimeDetails(request.newShowtimeId);
    const date = request.date ?? parsedShowtime?.date;
    if (!date) {
        throw new RescheduleRequestError(
            400,
            'date is required when it cannot be parsed from newShowtimeId.'
        );
    }
    parseDate(date);
    const time = request.time ?? parsedShowtime?.time ?? booking.time;
    if (typeof time !== 'string' || !TIME_PATTERN.test(time)) {
        throw new RescheduleRequestError(
            400,
            'time is required when it cannot be parsed from newShowtimeId or the existing booking.'
        );
    }
    const screen = request.screen ?? currentScreen;
    const updatedAt = new Date().toISOString();
    const updatedBooking = {
        ...booking,
        showtimeId: request.newShowtimeId,
        date,
        time,
        day: weekdayForDate(date),
        screen,
        updatedAt,
    };

    const transactItems = [
        {
            Delete: {
                TableName: tableName,
                Key: { showtimeId: oldShowtimeId, seatId: `BOOKING#${bookingId}` },
                ConditionExpression: 'attribute_exists(seatId)',
            },
        },
        {
            Put: {
                TableName: tableName,
                Item: updatedBooking,
                ConditionExpression: 'attribute_not_exists(seatId)',
            },
        },
        ...seats.map((seatId) => ({
            Delete: {
                TableName: tableName,
                Key: { showtimeId: oldShowtimeId, seatId },
            },
        })),
        ...seats.map((seatId) => ({
            Put: {
                TableName: tableName,
                Item: {
                    showtimeId: request.newShowtimeId,
                    seatId,
                    bookedAt,
                    bookingId,
                    date,
                    movieId,
                    recordType: 'SEAT',
                    screen,
                    time,
                    userId,
                },
                ConditionExpression: 'attribute_not_exists(seatId)',
            },
        })),
        {
            ConditionCheck: {
                TableName: registryTableName,
                Key: { registryKey: `SHOWTIME#${request.newShowtimeId}` },
                ConditionExpression:
                    'attribute_exists(registryKey) AND (attribute_not_exists(#status) OR #status = :active)',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: { ':active': 'ACTIVE' },
            },
        },
    ];

    await docClient.send(new TransactWriteCommand({
        TransactItems: transactItems,
    }));

    return {
        message: 'Booking rescheduled successfully.',
        bookingId,
        bookingRef,
        oldShowtimeId,
        showtimeId: request.newShowtimeId,
        date,
        day: updatedBooking.day,
        time,
        screen,
        seats,
        updatedAt,
    };
}

export async function handler(
    event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
    const query = event.queryStringParameters ?? {};
    const showtimeId = query.showtimeId?.trim();
    const bookingRef = query.bookingRef?.trim();
    if (!showtimeId || !bookingRef) {
        return json(400, { message: 'showtimeId and bookingRef query parameters are required.' });
    }
    if (!event.body) return json(400, { message: 'A JSON request body is required.' });

    let body: unknown;
    try {
        body = JSON.parse(event.isBase64Encoded
            ? Buffer.from(event.body, 'base64').toString('utf8')
            : event.body);
    } catch {
        return json(400, { message: 'Request body must contain valid JSON.' });
    }

    try {
        const request = parseRequest(body);
        return json(200, await rescheduleBooking(showtimeId, bookingRef, request));
    } catch (error: unknown) {
        if (error instanceof RescheduleRequestError) {
            return json(error.statusCode, { message: error.message });
        }
        if (error instanceof Error && error.name === 'TransactionCanceledException') {
            return json(409, {
                message: 'One or more seats are unavailable at the target showtime.',
            });
        }
        log('ERROR', 'Failed to reschedule booking', {
            requestId: event.requestContext?.requestId,
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        return json(500, { message: 'Unable to reschedule booking.' });
    }
}
