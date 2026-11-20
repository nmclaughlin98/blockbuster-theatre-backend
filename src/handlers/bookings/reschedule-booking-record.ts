import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import {
    DynamoDBDocumentClient,
    GetCommand,
    TransactWriteCommand,
    type TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from '../../main/lambda/handlers/Shared/dynamodb-client';
import { json, log, type OptionalJwtEvent } from '../../main/lambda/handlers/utils/common';

const docClient = DynamoDBDocumentClient.from(createDynamoDBClient());
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
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

function parseRequest(body: unknown): { newShowtimeId: string } {
    if (!isRecord(body)) {
        throw new RescheduleRequestError(400, 'Request body must be a JSON object.');
    }
    const { newShowtimeId } = body;
    if (Object.keys(body).some((key) => key !== 'newShowtimeId')
        || typeof newShowtimeId !== 'string'
        || !SHOWTIME_ID_PATTERN.test(newShowtimeId)) {
        throw new RescheduleRequestError(400, 'A valid newShowtimeId is required.');
    }
    return { newShowtimeId };
}

function requiredTableName(name: string): string {
    const tableName = process.env[name];
    if (!tableName) throw new Error(`${name} is not configured.`);
    return tableName;
}

function bookingFields(booking: UnknownRecord): {
    bookingId: string;
    seats: string[];
    bookedAt: string;
} {
    const { bookingId, seats, bookedAt } = booking;
    if (
        typeof bookingId !== 'string' || !bookingId
        || booking.PK !== `BOOKING#${bookingId}` || booking.SK !== 'METADATA'
        || !Array.isArray(seats) || seats.length === 0 || seats.length > 30
        || seats.some((seat: unknown) => typeof seat !== 'string' || !/^[A-G](?:[1-9]|1[01])$/.test(seat))
        || new Set(seats).size !== seats.length
        || typeof bookedAt !== 'string' || !bookedAt
        || (booking.userId !== undefined && booking.userId !== null
            && (typeof booking.userId !== 'string' || !booking.userId))
        || (booking.conversionTokenHash !== undefined
            && (typeof booking.conversionTokenHash !== 'string' || !booking.conversionTokenHash))
    ) {
        throw new Error('The stored booking record is invalid.');
    }
    return { bookingId, seats: seats as string[], bookedAt };
}

async function rescheduleBooking(
    bookingId: string,
    request: ReturnType<typeof parseRequest>
): Promise<UnknownRecord> {
    const tableName = requiredTableName('BOOKINGS_TABLE_NAME');
    const registryTableName = requiredTableName('SHOWTIME_REGISTRY_TABLE_NAME');
    const moviesTableName = requiredTableName('TABLE_NAME');
    const booking = (await docClient.send(new GetCommand({
        TableName: tableName, Key: { PK: `BOOKING#${bookingId}`, SK: 'METADATA' }, ConsistentRead: true,
    }))).Item;
    if (!booking) throw new RescheduleRequestError(404, 'Booking not found.');

    const fields = bookingFields(booking);
    if (fields.bookingId !== bookingId || typeof booking.showtimeId !== 'string'
        || typeof booking.bookingRef !== 'string') throw new Error('Stored booking is invalid.');
    const { seats } = fields;
    const oldShowtimeId = booking.showtimeId;
    const bookingRef = booking.bookingRef;
    if (request.newShowtimeId === oldShowtimeId) {
        throw new RescheduleRequestError(400, 'newShowtimeId must differ from showtimeId.');
    }
    const match = SHOWTIME_ID_PATTERN.exec(request.newShowtimeId)!;
    const targetResult = await docClient.send(new GetCommand({
        TableName: registryTableName,
        Key: { registryKey: `SHOWTIME#${request.newShowtimeId}` },
        ConsistentRead: true,
    }));
    const target = targetResult.Item;
    if (!target || target.status === 'CLOSING' || target.status === 'CANCELLED') {
        throw new RescheduleRequestError(404, 'Active target showtime not found.');
    }
    const date = target.date;
    const time = target.time;
    const screen = target.screen;
    const movieId = target.movieId;
    const dateValue = typeof date === 'string' ? new Date(`${date}T00:00:00Z`) : new Date(NaN);
    if (target.recordType !== 'SHOWTIME' || target.showtimeId !== request.newShowtimeId
        || typeof movieId !== 'string' || !movieId
        || typeof date !== 'string' || !DATE_PATTERN.test(date)
        || Number.isNaN(dateValue.getTime()) || dateValue.toISOString().slice(0, 10) !== date
        || date !== match[1] || time !== `${match[2].slice(0, 2)}:${match[2].slice(2)}`
        || typeof screen !== 'string' || !/^[1-5]$/.test(screen)
        || target.day !== dateValue.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
        || (target.status !== undefined && target.status !== 'ACTIVE')) {
        throw new Error('Stored target showtime is invalid.');
    }
    const day = target.day;
    const movieResult = await docClient.send(new GetCommand({
        TableName: moviesTableName,
        Key: { movieId },
        ConsistentRead: true,
    }));
    if (typeof movieResult.Item?.title !== 'string' || !movieResult.Item.title.trim()) {
        throw new Error('Target showtime has an invalid movie.');
    }
    const movieTitle = movieResult.Item.title;
    const updatedAt = new Date().toISOString();
    const updatedBooking = {
        ...booking,
        showtimeId: request.newShowtimeId,
        screeningKey: `${date}T${time}#${bookingId}`,
        movieId,
        movieTitle,
        date,
        time,
        day,
        screen,
        updatedAt,
    };

    const oldNames: Record<string, string> = {};
    const oldValues: Record<string, unknown> = {};
    const oldConditions = Object.entries(booking).map(([name, value], index) => {
        oldNames[`#old${index}`] = name;
        oldValues[`:old${index}`] = value;
        return `#old${index} = :old${index}`;
    });
    for (const name of ['userId', 'conversionTokenHash', 'updatedAt']) {
        if (!(name in booking)) {
            const key = `#absent${Object.keys(oldNames).length}`;
            oldNames[key] = name;
            oldConditions.push(`attribute_not_exists(${key})`);
        }
    }
    const transactItems: NonNullable<TransactWriteCommandInput['TransactItems']> = [
        {
            Put: {
                TableName: tableName,
                Item: updatedBooking,
                ConditionExpression: oldConditions.join(' AND '),
                ExpressionAttributeNames: oldNames,
                ExpressionAttributeValues: oldValues,
            },
        },
        ...seats.map((seatId) => ({
            Delete: {
                TableName: tableName,
                Key: { PK: `SHOWTIME#${oldShowtimeId}`, SK: `SEAT#${seatId}` },
                ConditionExpression: 'bookingId = :bookingId AND recordType = :seat',
                ExpressionAttributeValues: { ':bookingId': bookingId, ':seat': 'SEAT' },
            },
        })),
        ...seats.map((seatId) => ({
            Put: {
                TableName: tableName,
                Item: {
                    PK: `SHOWTIME#${request.newShowtimeId}`,
                    SK: `SEAT#${seatId}`,
                    bookingId,
                    recordType: 'SEAT',
                },
                ConditionExpression: 'attribute_not_exists(PK)',
            },
        })),
        {
            ConditionCheck: {
                TableName: registryTableName,
                Key: { registryKey: `SHOWTIME#${request.newShowtimeId}` },
                ConditionExpression:
                    'recordType = :showtime AND showtimeId = :showtimeId AND movieId = :movieId AND #date = :date AND #day = :day AND #time = :time AND screen = :screen AND (attribute_not_exists(#status) OR #status = :active)',
                ExpressionAttributeNames: { '#status': 'status', '#date': 'date', '#day': 'day', '#time': 'time' },
                ExpressionAttributeValues: {
                    ':showtime': 'SHOWTIME', ':showtimeId': request.newShowtimeId,
                    ':movieId': movieId, ':date': date, ':day': day, ':time': time,
                    ':screen': screen, ':active': 'ACTIVE',
                },
            },
        },
        {
            ConditionCheck: {
                TableName: moviesTableName,
                Key: { movieId },
                ConditionExpression: '#title = :movieTitle',
                ExpressionAttributeNames: { '#title': 'title' },
                ExpressionAttributeValues: { ':movieTitle': movieTitle },
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
        movieId,
        movieTitle,
        date,
        day: updatedBooking.day,
        time,
        screen,
        seats,
        updatedAt,
    };
}

export async function handler(
    event: OptionalJwtEvent
): Promise<APIGatewayProxyResultV2> {
    const subject = event.requestContext.authorizer?.jwt?.claims?.sub;
    if (typeof subject !== 'string' || !subject.trim()) {
        return json(401, { message: 'A valid Cognito user is required.' });
    }
    const bookingId = event.pathParameters?.bookingId?.trim();
    if (!bookingId) return json(400, { message: 'bookingId is required.' });
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
        return json(200, await rescheduleBooking(bookingId, request));
    } catch (error: unknown) {
        if (error instanceof RescheduleRequestError) {
            return json(error.statusCode, { message: error.message });
        }
        if (error instanceof Error && error.name === 'TransactionCanceledException'
            && (error as { CancellationReasons?: Array<{ Code?: string }> })
                .CancellationReasons?.some((reason) => reason.Code === 'ConditionalCheckFailed')) {
            return json(409, {
                message: 'The booking or target showtime changed, or a target seat is unavailable.',
            });
        }
        log('ERROR', 'Failed to reschedule booking', {
            requestId: event.requestContext?.requestId,
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        return json(500, { message: 'Unable to reschedule booking.' });
    }
}
