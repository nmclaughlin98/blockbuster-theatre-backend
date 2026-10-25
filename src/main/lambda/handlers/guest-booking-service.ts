import { createHash, randomBytes, randomInt, randomUUID } from 'crypto';
import {
    DynamoDBDocumentClient,
    QueryCommand,
    TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from './dynamodb-client';
import { PricingServiceError, validateCheckout } from './pricing-service';
import { sendBookingConfirmationEmail } from './booking-confirmation-service';
import { log } from './utils/common';
import { parseShowtimeId, resolveShowtimeId } from './utils/showtime-ids';

const docClient = DynamoDBDocumentClient.from(createDynamoDBClient());
const SEAT_ID_PATTERN = /^[A-G](?:[1-9]|1[01])$/;
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
    if (value.date !== parsedShowtime.date) {
        throw new GuestBookingError(400, 'date must match the date embedded in showtimeId.');
    }
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
        showtimeId: parsedShowtime.showtimeId,
        date: parsedShowtime.date,
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
    const screening = await resolveShowtimeId(request.showtimeId);
    if (screening.date !== request.date) {
        throw new GuestBookingError(400, 'date must match the date embedded in showtimeId.');
    }
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
                : { movieId: screening.movieId }),
            showtime: {
                day: screening.day,
                screen: screening.screen,
                time: screening.time,
            },
            tickets: request.tickets,
        });
    } catch (error: unknown) {
        if (error instanceof PricingServiceError) {
            throw new GuestBookingError(error.statusCode, error.message);
        }
        throw error;
    }
    if (checkout.movieId !== screening.movieId) {
        throw new GuestBookingError(400, 'showtimeId does not match the selected offer.');
    }

    const bookingId = `bk_${randomUUID()}`;
    const conversionToken = `cnv_tok_${randomBytes(32).toString('base64url')}`;
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + CONVERSION_TOKEN_TTL_SECONDS;
    const bookedAt = new Date().toISOString();
    const legacyShowingId = `${screening.movieId}#${request.date}#${screening.time}`;
    const bookingsTableName = requiredEnvironmentVariable('BOOKINGS_TABLE_NAME');
    const legacyBookingsTableName = requiredEnvironmentVariable('LEGACY_BOOKINGS_TABLE_NAME');
    const bookingReferencesTableName = requiredEnvironmentVariable(
        'BOOKING_REFERENCES_TABLE_NAME'
    );
    const tokenTableName = requiredEnvironmentVariable('GUEST_CONVERSION_TOKENS_TABLE_NAME');
    const bookingKey = { showtimeId: request.showtimeId, seatId: `BOOKING#${bookingId}` };
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
        day: screening.day,
        time: screening.time,
        screen: screening.screen,
        seats: request.seats,
        tickets: storedTickets,
        totalAmount: checkout.total,
        currency: checkout.currency,
        customerEmail: request.email,
        customerName: request.customerName,
        conversionTokenHash: tokenHash(conversionToken),
        bookedAt,
    };

    let bookingRef: string | undefined;
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const candidate = `BBT-${randomInt(100000, 1000000)}`;
        const transactionItems = [
                    ...request.seats.map((seatId) => ({
                        Put: {
                            TableName: bookingsTableName,
                            Item: {
                                showtimeId: request.showtimeId,
                                seatId,
                                recordType: 'SEAT',
                                bookingId,
                                date: request.date,
                                bookedAt,
                            },
                            ConditionExpression: 'attribute_not_exists(seatId)',
                        },
                    })),
                    {
                        Put: {
                            TableName: bookingsTableName,
                            Item: { ...booking, bookingRef: candidate },
                            ConditionExpression: 'attribute_not_exists(seatId)',
                        },
                    },
                    {
                        Put: {
                            TableName: tokenTableName,
                            Item: {
                                tokenHash: tokenHash(conversionToken),
                                bookingId,
                                showtimeId: request.showtimeId,
                                customerEmail: request.email,
                                expiresAt,
                            },
                            ConditionExpression: 'attribute_not_exists(tokenHash)',
                        },
                    },
                    {
                        Put: {
                            TableName: bookingReferencesTableName,
                            Item: {
                                bookingRef: candidate,
                                bookingId,
                                showtimeId: request.showtimeId,
                                date: request.date,
                                createdAt: bookedAt,
                            },
                            ConditionExpression: 'attribute_not_exists(bookingRef)',
                        },
                    },
                    ...request.seats.map((seatId) => ({
                        ConditionCheck: {
                            TableName: legacyBookingsTableName,
                            Key: { showingId: legacyShowingId, seatId },
                            ConditionExpression: 'attribute_not_exists(seatId)',
                        },
                    })),
                ];
        try {
            await docClient.send(
                new TransactWriteCommand({ TransactItems: transactionItems })
            );
            bookingRef = candidate;
            break;
        } catch (error: unknown) {
            if (!(error instanceof Error) || error.name !== 'TransactionCanceledException') {
                throw error;
            }
            const reasons = (
                error as { CancellationReasons?: Array<{ Code?: string }> }
            ).CancellationReasons;
            const seatConflict =
                reasons?.slice(0, request.seats.length).some(
                    (reason) => reason.Code === 'ConditionalCheckFailed'
                ) ||
                reasons?.slice(request.seats.length + 3).some(
                    (reason) => reason.Code === 'ConditionalCheckFailed'
                );
            if (seatConflict) {
                throw new GuestBookingError(
                    409,
                    'One or more selected seats are no longer available.'
                );
            }
            if (reasons?.[request.seats.length + 2]?.Code === 'ConditionalCheckFailed') {
                continue;
            }
            throw error;
        }
    }
    if (!bookingRef) throw new Error('Unable to allocate a unique booking reference.');

    const nameParts = request.customerName.split(/\s+/);
    const firstName = nameParts.shift() ?? request.customerName;
    const surname = nameParts.join(' ') || 'Guest';
    let confirmationEmailSent = true;
    try {
        await sendBookingConfirmationEmail({
            bookingRef,
            customer: {
                firstName,
                surname,
                email: request.email,
            },
            movieTitle: checkout.movieTitle,
            date: request.date,
            time: screening.time,
            screen: screening.screen,
            seats: request.seats,
            tickets: request.seats.length,
            totalPrice: checkout.total,
        });
    } catch (error: unknown) {
        confirmationEmailSent = false;
        log('ERROR', 'Guest booking created but confirmation email failed', {
            bookingId,
            errorName: error instanceof Error ? error.name : 'UnknownError',
        });
    }
    return {
        bookingId,
        bookingRef,
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
        confirmationEmailSent,
    };
}

export async function listGuestBookedSeats(
    showtimeId: string | undefined,
    date: string | undefined
): Promise<{ showtimeId: string; date: string; bookedSeats: string[] }> {
    const screening = await resolveShowtimeId(showtimeId);
    if (date !== screening.date) {
        throw new GuestBookingError(400, 'date must match the date embedded in showtimeId.');
    }
    const legacyShowingId = `${screening.movieId}#${screening.date}#${screening.time}`;
    const seats: string[] = [];
    for (const [tableName, keyName, keyValue, filterExpression, filterValue] of [
        [
            requiredEnvironmentVariable('BOOKINGS_TABLE_NAME'),
            'showtimeId',
            screening.showtimeId,
            'recordType = :seat',
            'SEAT',
        ],
        [
            requiredEnvironmentVariable('LEGACY_BOOKINGS_TABLE_NAME'),
            'showingId',
            legacyShowingId,
            undefined,
            undefined,
        ],
    ] as const) {
        let exclusiveStartKey: Record<string, unknown> | undefined;
        do {
            const result = await docClient.send(
                new QueryCommand({
                    TableName: tableName,
                    KeyConditionExpression: `${keyName} = :key`,
                    ...(filterExpression && { FilterExpression: filterExpression }),
                    ExpressionAttributeValues: {
                        ':key': keyValue,
                        ...(filterValue && { ':seat': filterValue }),
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
        showtimeId: screening.showtimeId,
        date: screening.date,
        bookedSeats: [...new Set(seats)].sort(),
    };
}
