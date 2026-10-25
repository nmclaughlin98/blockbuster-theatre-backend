import { randomUUID } from 'crypto';
import {
    DynamoDBDocumentClient,
    QueryCommand,
    TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from './dynamodb-client';
import type { BookingRecord } from './interfaces';
import { PricingServiceError, resolvePricing, type ShowtimeSelection } from './pricing-service';
import { createShowtimeId } from './utils/showtime-ids';

const docClient = DynamoDBDocumentClient.from(createDynamoDBClient());
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Rows A-G, seat numbers 1-11 (row G has 11 seats; rows A-F have 10).
const SEAT_ID_PATTERN = /^[A-G](?:[1-9]|1[01])$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_SEATS_PER_BOOKING = 10;

type UnknownRecord = Record<string, unknown>;

export class BookingServiceError extends Error {
    constructor(
        public readonly statusCode: number,
        message: string
    ) {
        super(message);
        this.name = 'BookingServiceError';
    }
}

export interface ShowingSelection {
    movieId: string;
    /** Calendar date of the showing, YYYY-MM-DD. */
    date: string;
    showtime: ShowtimeSelection;
}

export interface CreatedBooking {
    bookingId: string;
    userId: string;
    movieId: string;
    movieTitle: string;
    date: string;
    showtimeId: string;
    showtime: ShowtimeSelection;
    seats: string[];
    bookedAt: string;
}

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function bookingsTableName(): string {
    const tableName = process.env.BOOKINGS_TABLE_NAME;
    if (!tableName) throw new BookingServiceError(500, 'BOOKINGS_TABLE_NAME is not configured.');
    return tableName;
}

function legacyShowingId(movieId: string, date: string, time: string): string {
    return `${movieId}#${date}#${time}`;
}

function isScreen(value: unknown): value is NonNullable<ShowtimeSelection['screen']> {
    return value === '1' || value === '2' || value === '3' || value === '4' || value === '5';
}

function parseMovieId(value: unknown): string {
    const movieId =
        typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
    if (typeof movieId !== 'string' || !/^\d+$/.test(movieId)) {
        throw new BookingServiceError(400, 'movieId must be a numeric movie ID.');
    }
    return movieId;
}

function parseShowtime(day: unknown, time: unknown, screen?: unknown): ShowtimeSelection {
    if (
        typeof day !== 'string' ||
        !DAYS.includes(day) ||
        typeof time !== 'string' ||
        !TIME_PATTERN.test(time) ||
        (screen !== undefined && !isScreen(screen))
    ) {
        throw new BookingServiceError(
            400,
            'showtime.day must be a weekday name and showtime.time must use HH:mm.'
        );
    }
    return { day, time, ...(isScreen(screen) && { screen }) };
}

/** Validates a YYYY-MM-DD calendar date whose weekday matches the showtime's day. */
function parseDate(value: unknown, day: string): string {
    const match = typeof value === 'string' ? DATE_PATTERN.exec(value) : null;
    if (!match) {
        throw new BookingServiceError(400, 'date must be a valid calendar date in YYYY-MM-DD format.');
    }

    const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    if (parsed.toISOString().slice(0, 10) !== value) {
        throw new BookingServiceError(400, 'date must be a valid calendar date in YYYY-MM-DD format.');
    }
    // getUTCDay is Sunday-first; DAYS is Monday-first.
    if (DAYS[(parsed.getUTCDay() + 6) % 7] !== day) {
        throw new BookingServiceError(400, `date ${value} is not a ${day}.`);
    }
    return value as string;
}

/** Today's date at the theatre (UK time) as YYYY-MM-DD. */
function todayInTheatre(): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/London',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());
}

/**
 * Generates the user ID stored against a booking.
 * Placeholder until the login system exists; replace with the authenticated user's ID.
 */
export function resolveBookingUserId(): string {
    return randomUUID();
}

/**
 * Validates the query-string parameters used to look up a showing's booked seats.
 * @param query API Gateway query string parameters.
 * @returns The movie, date, and showtime to look up.
 */
export function parseShowingQuery(
    query: Record<string, string | undefined>
): ShowingSelection {
    const showtime = parseShowtime(query.day, query.time, query.screen);
    return {
        movieId: parseMovieId(query.movieId),
        date: parseDate(query.date, showtime.day),
        showtime,
    };
}

/**
 * Lists the seats already booked for a showing.
 * @param selection Movie, date, and showtime to look up.
 * @returns The resolved showtime and booked seat IDs sorted alphabetically.
 */
export async function listBookedSeats(
    selection: ShowingSelection
): Promise<{ showtime: ShowtimeSelection; bookedSeats: string[] }> {
    let showtime: ShowtimeSelection;
    try {
        const resolved = await resolvePricing({
            movieId: selection.movieId,
            showtime: selection.showtime,
        });
        showtime = resolved.showtime;
    } catch (error: unknown) {
        if (error instanceof PricingServiceError) {
            throw new BookingServiceError(error.statusCode, error.message);
        }
        throw error;
    }
    if (!showtime.screen) throw new Error('Pricing resolution did not return a screen.');
    const showtimeId = await createShowtimeId(
        selection.movieId,
        showtime.day,
        selection.date,
        { screen: showtime.screen, time: showtime.time }
    );
    const seats: string[] = [];
    for (const [tableName, keyName, keyValue, recordFilter] of [
        [bookingsTableName(), 'showtimeId', showtimeId, 'recordType = :seat'],
        [
            requiredEnvironmentVariable('LEGACY_BOOKINGS_TABLE_NAME'),
            'showingId',
            legacyShowingId(selection.movieId, selection.date, showtime.time),
            undefined,
        ],
    ] as const) {
        let exclusiveStartKey: Record<string, unknown> | undefined;
        do {
            const result = await docClient.send(
                new QueryCommand({
                    TableName: tableName,
                    KeyConditionExpression: `${keyName} = :key`,
                    ...(recordFilter && { FilterExpression: recordFilter }),
                    ExpressionAttributeValues: {
                        ':key': keyValue,
                        ...(recordFilter && { ':seat': 'SEAT' }),
                    },
                    ProjectionExpression: 'seatId',
                    ConsistentRead: true,
                    ExclusiveStartKey: exclusiveStartKey,
                })
            );
            for (const item of result.Items ?? []) {
                if (typeof item.seatId === 'string') seats.push(item.seatId);
            }
            exclusiveStartKey = result.LastEvaluatedKey;
        } while (exclusiveStartKey);
    }
    return {
        showtime,
        bookedSeats: [...new Set(seats)].sort(),
    };
}

function requiredEnvironmentVariable(name: string): string {
    const value = process.env[name];
    if (!value) throw new BookingServiceError(500, `${name} is not configured.`);
    return value;
}

function parseSeats(value: unknown): string[] {
    if (!Array.isArray(value) || value.length === 0) {
        throw new BookingServiceError(400, 'seats must be a non-empty array of seat IDs.');
    }
    if (value.length > MAX_SEATS_PER_BOOKING) {
        throw new BookingServiceError(
            400,
            `A maximum of ${MAX_SEATS_PER_BOOKING} seats can be booked at once.`
        );
    }

    const seats = value.map((seat) => (typeof seat === 'string' ? seat.trim().toUpperCase() : ''));
    const invalid = seats.find((seat) => !SEAT_ID_PATTERN.test(seat));
    if (invalid !== undefined) {
        throw new BookingServiceError(
            400,
            'Each seat must be a row letter A-G followed by a seat number 1-11, e.g. B4.'
        );
    }
    if (new Set(seats).size !== seats.length) {
        throw new BookingServiceError(400, 'Seats must not be repeated.');
    }
    return seats;
}

function parseBookingRequest(value: unknown): {
    movieId: string;
    offerId?: string;
    date: string;
    showtime: ShowtimeSelection;
    seats: string[];
} {
    if (!isRecord(value)) {
        throw new BookingServiceError(400, 'A JSON request object is required.');
    }
    if (
        Object.keys(value).some(
            (key) => !['movieId', 'offerId', 'date', 'showtime', 'seats'].includes(key)
        )
    ) {
        throw new BookingServiceError(
            400,
            'Only movieId, offerId, date, showtime, and seats are accepted.'
        );
    }
    if (!isRecord(value.showtime)) {
        throw new BookingServiceError(400, 'showtime with day and time is required.');
    }
    if (Object.keys(value.showtime).some((key) => !['day', 'time', 'screen'].includes(key))) {
        throw new BookingServiceError(400, 'showtime only accepts day, time, and optional screen.');
    }
    if (
        value.offerId !== undefined &&
        (typeof value.offerId !== 'string' || !value.offerId.trim())
    ) {
        throw new BookingServiceError(400, 'offerId must be a non-empty string.');
    }

    const showtime = parseShowtime(
        value.showtime.day,
        value.showtime.time,
        value.showtime.screen
    );
    return {
        movieId: parseMovieId(value.movieId),
        offerId: typeof value.offerId === 'string' ? value.offerId.trim() : undefined,
        date: parseDate(value.date, showtime.day),
        showtime,
        seats: parseSeats(value.seats),
    };
}

function conflictingSeats(error: unknown, seats: string[]): string[] | undefined {
    if (!(error instanceof Error) || error.name !== 'TransactionCanceledException') {
        return undefined;
    }
    const reasons = (error as { CancellationReasons?: Array<{ Code?: string }> })
        .CancellationReasons;
    const taken = seats.filter((_, index) => reasons?.[index]?.Code === 'ConditionalCheckFailed');
    return taken.length > 0 ? taken : undefined;
}

/**
 * Books seats for a showing. All seats are reserved atomically, so a booking either
 * succeeds in full or fails without reserving any seat.
 * @param value Parsed JSON request body.
 * @returns The created booking.
 * @throws BookingServiceError for invalid requests, unknown showtimes, or already-booked seats.
 */
export async function createBooking(value: unknown): Promise<CreatedBooking> {
    const request = parseBookingRequest(value);
    if (request.date < todayInTheatre()) {
        throw new BookingServiceError(400, 'date must not be in the past.');
    }

    let resolved;
    try {
        // Pricing resolution takes either a movie or an offer, never both.
        resolved = await resolvePricing({
            ...(request.offerId
                ? { offerId: request.offerId }
                : { movieId: request.movieId }),
            showtime: request.showtime,
        });
    } catch (error: unknown) {
        if (error instanceof PricingServiceError) {
            throw new BookingServiceError(error.statusCode, error.message);
        }
        throw error;
    }
    if (resolved.movieId !== request.movieId) {
        throw new BookingServiceError(400, 'movieId does not match the selected offer.');
    }

    const bookingId = randomUUID();
    const userId = resolveBookingUserId();
    const bookedAt = new Date().toISOString();
    const tableName = bookingsTableName();
    const screen = resolved.showtime.screen;
    if (!screen) throw new Error('Pricing resolution did not return a screen.');
    const showtimeId = await createShowtimeId(
        resolved.movieId,
        request.showtime.day,
        request.date,
        { screen, time: request.showtime.time }
    );
    const legacyTableName = requiredEnvironmentVariable('LEGACY_BOOKINGS_TABLE_NAME');
    const legacyId = legacyShowingId(
        resolved.movieId,
        request.date,
        request.showtime.time
    );

    const records: BookingRecord[] = request.seats.map((seatId) => ({
        showtimeId,
        seatId,
        bookingId,
        userId,
        movieId: resolved.movieId,
        date: request.date,
        screen,
        time: request.showtime.time,
        bookedAt,
        recordType: 'SEAT',
    }));

    try {
        await docClient.send(
            new TransactWriteCommand({
                TransactItems: [
                    ...records.map((record) => ({
                        Put: {
                            TableName: tableName,
                            Item: record,
                            ConditionExpression: 'attribute_not_exists(seatId)',
                        },
                    })),
                    ...request.seats.map((seatId) => ({
                        ConditionCheck: {
                            TableName: legacyTableName,
                            Key: { showingId: legacyId, seatId },
                            ConditionExpression: 'attribute_not_exists(seatId)',
                        },
                    })),
                ],
            })
        );
    } catch (error: unknown) {
        const reasons = error instanceof Error && error.name === 'TransactionCanceledException'
            ? (error as { CancellationReasons?: Array<{ Code?: string }> }).CancellationReasons
            : undefined;
        const conflicts = reasons?.some((reason) => reason.Code === 'ConditionalCheckFailed');
        const taken = conflictingSeats(error, request.seats);
        if (taken || conflicts) {
            throw new BookingServiceError(
                409,
                taken
                    ? `Seat${taken.length > 1 ? 's' : ''} already booked: ${taken.join(', ')}.`
                    : 'One or more selected seats are no longer available.'
            );
        }
        throw error;
    }

    return {
        bookingId,
        userId,
        movieId: resolved.movieId,
        movieTitle: resolved.movieTitle,
        date: request.date,
        showtimeId,
        showtime: resolved.showtime,
        seats: request.seats,
        bookedAt,
    };
}
