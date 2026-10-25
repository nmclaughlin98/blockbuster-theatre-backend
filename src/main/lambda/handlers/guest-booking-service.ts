import { createHash, randomBytes, randomUUID } from 'crypto';
import {
    DynamoDBDocumentClient,
    QueryCommand,
    TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from './dynamodb-client';
import { PricingServiceError, validateCheckout } from './pricing-service';
import { createShowtimeId, parseShowtimeId } from './utils/showtime-ids';

const docClient = DynamoDBDocumentClient.from(createDynamoDBClient());
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const SEAT_ID_PATTERN = /^[A-G](?:[1-9]|1[01])$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_SEATS_PER_BOOKING = 10;
const CONVERSION_TOKEN_TTL_SECONDS = 24 * 60 * 60;

type UnknownRecord = Record<string, unknown>;

export class GuestBookingError extends Error {
    constructor(
        public readonly statusCode: number,
        message: string
    ) {
        super(message);
        this.name = 'GuestBookingError';
    }
}

export interface GuestBookingRequest {
    showtimeId: string;
    date: string;
    offerId?: string;
    seats: string[];
    email: string;
    customerName: string;
    tickets: Array<{ tierId: string; quantity: number }>;
}

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredEnvironmentVariable(name: string): string {
    const value = process.env[name];
    if (!value) throw new GuestBookingError(500, `${name} is not configured.`);
    return value;
}

function parseDate(value: unknown, day: string): string {
    const match = typeof value === 'string' ? DATE_PATTERN.exec(value) : null;
    if (!match) {
        throw new GuestBookingError(400, 'date must be a valid calendar date in YYYY-MM-DD format.');
    }
    const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    if (parsed.toISOString().slice(0, 10) !== value) {
        throw new GuestBookingError(400, 'date must be a valid calendar date in YYYY-MM-DD format.');
    }
    if (DAYS[(parsed.getUTCDay() + 6) % 7] !== day) {
        throw new GuestBookingError(400, `date ${value} is not a ${day}.`);
    }

    const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/London',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());
    if (value < today) throw new GuestBookingError(400, 'date must not be in the past.');
    return value;
}

function parseSeats(value: unknown): string[] {
    if (!Array.isArray(value) || value.length === 0) {
        throw new GuestBookingError(400, 'seats must be a non-empty array of seat IDs.');
    }
    if (value.length > MAX_SEATS_PER_BOOKING) {
        throw new GuestBookingError(
            400,
            `A maximum of ${MAX_SEATS_PER_BOOKING} seats can be booked at once.`
        );
    }

    const seats = value.map((seat) =>
        typeof seat === 'string' ? seat.trim().toUpperCase() : ''
    );
    if (seats.some((seat) => !SEAT_ID_PATTERN.test(seat))) {
        throw new GuestBookingError(
            400,
            'Each seat must be a row letter A-G followed by a seat number 1-11, e.g. F10.'
        );
    }
    if (new Set(seats).size !== seats.length) {
        throw new GuestBookingError(400, 'Seats must not be repeated.');
    }
    return seats;
}

function parseRequest(value: unknown): GuestBookingRequest {
    if (!isRecord(value)) throw new GuestBookingError(400, 'A JSON request object is required.');
    if (
        Object.keys(value).some(
            (key) =>
                ![
                    'showtimeId',
                    'date',
                    'offerId',
                    'seats',
                    'email',
                    'customerName',
                    'tickets',
                ].includes(key)
        )
    ) {
        throw new GuestBookingError(
            400,
            'Only showtimeId, date, offerId, seats, email, customerName, and tickets are accepted.'
        );
    }

    const parsedShowtime = parseShowtimeId(value.showtimeId);
    if (!parsedShowtime) throw new GuestBookingError(400, 'showtimeId is invalid.');
    if (
        value.offerId !== undefined &&
        (typeof value.offerId !== 'string' || !value.offerId.trim())
    ) {
        throw new GuestBookingError(400, 'offerId must be a non-empty string.');
    }
    if (
        typeof value.email !== 'string' ||
        value.email.length > 254 ||
        !EMAIL_PATTERN.test(value.email.trim())
    ) {
        throw new GuestBookingError(400, 'A valid email address is required.');
    }
    if (
        typeof value.customerName !== 'string' ||
        !value.customerName.trim() ||
        value.customerName.trim().length > 100
    ) {
        throw new GuestBookingError(400, 'customerName must contain 1-100 characters.');
    }

    return {
        showtimeId: createShowtimeId(
            parsedShowtime.movieId,
            parsedShowtime.day,
            parsedShowtime
        ),
        date: parseDate(value.date, parsedShowtime.day),
        ...(typeof value.offerId === 'string' && { offerId: value.offerId.trim() }),
        seats: parseSeats(value.seats),
        email: value.email.trim().toLowerCase(),
        customerName: value.customerName.trim(),
        tickets: parseTickets(value.tickets),
    };
}

function parseTickets(value: unknown): Array<{ tierId: string; quantity: number }> {
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SEATS_PER_BOOKING) {
        throw new GuestBookingError(
            400,
            `tickets must contain 1-${MAX_SEATS_PER_BOOKING} ticket tiers.`
        );
    }
    const tickets: Array<{ tierId: string; quantity: number }> = [];
    for (const ticket of value) {
        if (
            !isRecord(ticket) ||
            Object.keys(ticket).some((key) => !['tierId', 'quantity'].includes(key)) ||
            typeof ticket.tierId !== 'string' ||
            !ticket.tierId.trim() ||
            !Number.isSafeInteger(ticket.quantity) ||
            (ticket.quantity as number) < 1
        ) {
            throw new GuestBookingError(
                400,
                'Each ticket must include a tierId and a positive integer quantity.'
            );
        }
        tickets.push({
            tierId: ticket.tierId.trim(),
            quantity: ticket.quantity as number,
        });
    }
    return tickets;
}

function tokenHash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

export async function createGuestBooking(value: unknown): Promise<Record<string, unknown>> {
    const request = parseRequest(value);
    const parsedShowtime = parseShowtimeId(request.showtimeId);
    if (!parsedShowtime) throw new Error('Validated showtime ID could not be parsed.');
    let ticketCount = 0;
    for (const ticket of request.tickets) {
        ticketCount += ticket.quantity;
        if (!Number.isSafeInteger(ticketCount) || ticketCount > request.seats.length) {
            throw new GuestBookingError(
                400,
                'Ticket quantities must add up to the selected seat count.'
            );
        }
    }
    if (ticketCount !== request.seats.length) {
        throw new GuestBookingError(400, 'Ticket quantities must add up to the selected seat count.');
    }

    let checkout: Awaited<ReturnType<typeof validateCheckout>>;
    try {
        checkout = await validateCheckout({
            ...(request.offerId
                ? { offerId: request.offerId }
                : { movieId: parsedShowtime.movieId }),
            showtime: {
                day: parsedShowtime.day,
                screen: parsedShowtime.screen,
                time: parsedShowtime.time,
            },
            tickets: request.tickets,
        });
    } catch (error: unknown) {
        if (error instanceof PricingServiceError) {
            throw new GuestBookingError(error.statusCode, error.message);
        }
        throw error;
    }
    if (checkout.movieId !== parsedShowtime.movieId) {
        throw new GuestBookingError(400, 'showtimeId does not match the selected offer.');
    }

    const bookingId = `bk_${randomUUID()}`;
    const conversionToken = `cnv_tok_${randomBytes(32).toString('base64url')}`;
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + CONVERSION_TOKEN_TTL_SECONDS;
    const bookedAt = new Date().toISOString();
    const showingId = `${request.showtimeId}#${request.date}`;
    const bookingsTableName = requiredEnvironmentVariable('BOOKINGS_TABLE_NAME');
    const tokenTableName = requiredEnvironmentVariable('GUEST_CONVERSION_TOKENS_TABLE_NAME');
    const bookingKey = { showingId, seatId: `BOOKING#${bookingId}` };
    const storedTickets = checkout.tickets.map((ticket) => ({
        tierId: ticket.tierId,
        label: ticket.label,
        quantity: ticket.quantity,
        unitPrice: ticket.unitPrice,
        subtotal: ticket.subtotal,
    }));
    const booking = {
        ...bookingKey,
        recordType: 'BOOKING',
        bookingId,
        showtimeId: request.showtimeId,
        movieId: checkout.movieId,
        movieTitle: checkout.movieTitle,
        date: request.date,
        day: parsedShowtime.day,
        time: parsedShowtime.time,
        screen: parsedShowtime.screen,
        seats: request.seats,
        tickets: storedTickets,
        totalAmount: checkout.total,
        currency: checkout.currency,
        customerEmail: request.email,
        customerName: request.customerName,
        conversionTokenHash: tokenHash(conversionToken),
        bookedAt,
    };

    try {
        await docClient.send(
            new TransactWriteCommand({
                TransactItems: [
                    ...request.seats.map((seatId) => ({
                        Put: {
                            TableName: bookingsTableName,
                            Item: {
                                showingId,
                                seatId,
                                recordType: 'SEAT',
                                bookingId,
                                showtimeId: request.showtimeId,
                                date: request.date,
                                bookedAt,
                            },
                            ConditionExpression: 'attribute_not_exists(seatId)',
                        },
                    })),
                    {
                        Put: {
                            TableName: bookingsTableName,
                            Item: booking,
                            ConditionExpression: 'attribute_not_exists(seatId)',
                        },
                    },
                    {
                        Put: {
                            TableName: tokenTableName,
                            Item: {
                                tokenHash: tokenHash(conversionToken),
                                bookingId,
                                showingId,
                                customerEmail: request.email,
                                expiresAt,
                            },
                            ConditionExpression: 'attribute_not_exists(tokenHash)',
                        },
                    },
                ],
            })
        );
    } catch (error: unknown) {
        if (
            error instanceof Error &&
            error.name === 'TransactionCanceledException' &&
            (error as { CancellationReasons?: Array<{ Code?: string }> })
                .CancellationReasons?.some(
                    (reason) => reason.Code === 'ConditionalCheckFailed'
                )
        ) {
            throw new GuestBookingError(409, 'One or more selected seats are no longer available.');
        }
        throw error;
    }

    return {
        bookingId,
        showtimeId: request.showtimeId,
        movieTitle: checkout.movieTitle,
        seats: request.seats,
        tickets: storedTickets,
        totalAmount: checkout.total,
        currency: checkout.currency,
        customerEmail: request.email,
        date: request.date,
        conversionToken,
        conversionTokenExpiresAt: new Date(expiresAt * 1000).toISOString(),
    };
}

export async function listGuestBookedSeats(
    showtimeId: string | undefined,
    date: string | undefined
): Promise<{ showtimeId: string; date: string; bookedSeats: string[] }> {
    const parsedShowtime = parseShowtimeId(showtimeId);
    if (!parsedShowtime) throw new GuestBookingError(400, 'showtimeId is invalid.');
    const validatedShowtimeId = createShowtimeId(
        parsedShowtime.movieId,
        parsedShowtime.day,
        parsedShowtime
    );
    const validatedDate = parseDate(date, parsedShowtime.day);
    const showingId = `${validatedShowtimeId}#${validatedDate}`;
    const seats: string[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;
    do {
        const result = await docClient.send(
            new QueryCommand({
                TableName: requiredEnvironmentVariable('BOOKINGS_TABLE_NAME'),
                KeyConditionExpression: 'showingId = :showingId',
                FilterExpression: 'recordType = :seat',
                ExpressionAttributeValues: {
                    ':showingId': showingId,
                    ':seat': 'SEAT',
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

    return { showtimeId: validatedShowtimeId, date: validatedDate, bookedSeats: seats.sort() };
}
