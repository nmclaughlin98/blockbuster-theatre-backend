import { createHash, randomBytes, randomInt, randomUUID } from 'crypto';
import {
    DynamoDBDocumentClient,
    GetCommand,
    QueryCommand,
    TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from '../../main/lambda/handlers/Shared/dynamodb-client';
import { getMaxTickets } from '../../main/lambda/handlers/Shared/max-tickets-service';
import { PricingServiceError, validateCheckout } from '../checkout/pricing-service';
import { sendBookingConfirmationEmail } from './booking-confirmation-service';
import { log } from '../../main/lambda/handlers/utils/common';
import { parseShowtimeId, resolveShowtimeId } from '../../main/lambda/handlers/utils/showtime-ids';

const docClient = DynamoDBDocumentClient.from(createDynamoDBClient());
const SEAT_ID_PATTERN = /^[A-G](?:[1-9]|1[01])$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_SEATS_PER_BOOKING = 30;
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

export async function createGuestBooking(
    value: unknown,
    userId?: string
): Promise<Record<string, unknown>> {
    if (userId !== undefined && !userId.trim()) {
        throw new GuestBookingError(400, 'userId must be a non-empty Cognito subject.');
    }
    const request = parseRequest(value);
    const maxTickets = await getMaxTickets();
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
        if (ticketCount > maxTickets) {
            throw new GuestBookingError(
                400,
                `A maximum of ${maxTickets} tickets can be booked at once.`
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
            date: request.date,
            showtime: {
                day: screening.day,
                screen: screening.screen,
                time: screening.time,
            },
            tickets: request.tickets,
        }, screening);
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
    const now = Math.floor(Date.now() / 1000);
    const bookingOwnership = userId === undefined
        ? {
            kind: 'guest' as const,
            conversionToken: `cnv_tok_${randomBytes(32).toString('base64url')}`,
            expiresAt: now + CONVERSION_TOKEN_TTL_SECONDS,
            conversionTokenTableName: requiredEnvironmentVariable(
                'GUEST_CONVERSION_TOKENS_TABLE_NAME'
            ),
        }
        : { kind: 'account' as const, userId };
    const bookedAt = new Date().toISOString();
    const bookingsTableName = requiredEnvironmentVariable('BOOKINGS_TABLE_NAME');
    const showtimeRegistryTableName = requiredEnvironmentVariable(
        'SHOWTIME_REGISTRY_TABLE_NAME'
    );
    const bookingKey = { PK: `BOOKING#${bookingId}`, SK: 'METADATA' };
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
        screeningKey: `${request.date}T${screening.time}#${bookingId}`,
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
        ...(bookingOwnership.kind === 'guest'
            ? { conversionTokenHash: tokenHash(bookingOwnership.conversionToken) }
            : { userId: bookingOwnership.userId }),
        bookedAt,
    };

    let bookingRef: string | undefined;
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const candidate = `BBT-${randomInt(100000, 1000000)}`;
        const bookingReferenceIndex =
            request.seats.length + (bookingOwnership.kind === 'guest' ? 2 : 1);
        const transactionItems = [
            ...request.seats.map((seatId) => ({
                Put: {
                    TableName: bookingsTableName,
                    Item: {
                        PK: `SHOWTIME#${request.showtimeId}`,
                        SK: `SEAT#${seatId}`,
                        recordType: 'SEAT',
                        bookingId,
                    },
                    ConditionExpression: 'attribute_not_exists(PK)',
                },
            })),
            {
                Put: {
                    TableName: bookingsTableName,
                    Item: { ...booking, bookingRef: candidate },
                    ConditionExpression: 'attribute_not_exists(PK)',
                },
            },
            ...(bookingOwnership.kind === 'guest'
                ? [{
                    Put: {
                        TableName: bookingOwnership.conversionTokenTableName,
                        Item: {
                            tokenHash: tokenHash(bookingOwnership.conversionToken),
                            bookingId,
                            customerEmail: request.email,
                            expiresAt: bookingOwnership.expiresAt,
                        },
                        ConditionExpression: 'attribute_not_exists(tokenHash)',
                    },
                }]
                : []),
            {
                Put: {
                    TableName: bookingsTableName,
                    Item: {
                        PK: `REFERENCE#${candidate}`,
                        SK: 'METADATA',
                        recordType: 'REFERENCE',
                        bookingId,
                    },
                    ConditionExpression: 'attribute_not_exists(PK)',
                },
            },
            {
                ConditionCheck: {
                    TableName: showtimeRegistryTableName,
                    Key: { registryKey: `SHOWTIME#${request.showtimeId}` },
                    ConditionExpression:
                        'recordType = :showtime AND movieId = :movieId AND #date = :date AND #day = :day AND #time = :time AND screen = :screen AND (attribute_not_exists(#status) OR #status = :active)',
                    ExpressionAttributeNames: { '#status': 'status', '#date': 'date', '#day': 'day', '#time': 'time' },
                    ExpressionAttributeValues: {
                        ':showtime': 'SHOWTIME', ':movieId': screening.movieId,
                        ':date': screening.date, ':day': screening.day, ':time': screening.time,
                        ':screen': screening.screen, ':active': 'ACTIVE',
                    },
                },
            },
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
                reasons?.slice(bookingReferenceIndex + 1).some(
                    (reason) => reason.Code === 'ConditionalCheckFailed'
                );
            if (seatConflict) {
                throw new GuestBookingError(
                    409,
                    'One or more selected seats are no longer available.'
                );
            }
            if (reasons?.[bookingReferenceIndex]?.Code === 'ConditionalCheckFailed') {
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
        ...(bookingOwnership.kind === 'guest' && {
            conversionToken: bookingOwnership.conversionToken,
            conversionTokenExpiresAt: new Date(
                bookingOwnership.expiresAt * 1000
            ).toISOString(),
        }),
        confirmationEmailSent,
    };
}

export async function listGuestBookedSeats(
    showtimeId: string | undefined,
    date: string | undefined,
    userId?: string
): Promise<{ showtimeId: string; date: string; bookedSeats: string[]; myBookedSeats?: string[] }> {
    if (userId !== undefined && !userId.trim()) {
        throw new GuestBookingError(400, 'userId must be a non-empty Cognito subject.');
    }
    const screening = await resolveShowtimeId(showtimeId);
    if (date !== undefined && date !== screening.date) {
        throw new GuestBookingError(400, 'date must match the date embedded in showtimeId.');
    }
    const seats: string[] = [];
    const mySeats: string[] = [];
    const tableName = requiredEnvironmentVariable('BOOKINGS_TABLE_NAME');
    const locks: Array<{ seat: string; bookingId: string }> = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;
    do {
        const result = await docClient.send(new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: 'PK = :showtime AND begins_with(SK, :seat)',
            ExpressionAttributeValues: { ':showtime': `SHOWTIME#${screening.showtimeId}`, ':seat': 'SEAT#' },
            ConsistentRead: true,
            ExclusiveStartKey: exclusiveStartKey,
        }));
        for (const item of result.Items ?? []) {
            if (item.recordType !== 'SEAT' || typeof item.SK !== 'string'
                || !item.SK.startsWith('SEAT#') || typeof item.bookingId !== 'string') {
                throw new Error('DynamoDB returned an invalid seat lock.');
            }
            locks.push({ seat: item.SK.slice(5), bookingId: item.bookingId });
            seats.push(item.SK.slice(5));
        }
        exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);
    if (userId) {
        for (const bookingId of new Set(locks.map((lock) => lock.bookingId))) {
            const result = await docClient.send(new GetCommand({
                TableName: tableName,
                Key: { PK: `BOOKING#${bookingId}`, SK: 'METADATA' },
                ConsistentRead: true,
            }));
            if (result.Item?.userId === userId && result.Item.showtimeId === screening.showtimeId) {
                mySeats.push(...locks.filter((lock) => lock.bookingId === bookingId).map((lock) => lock.seat));
            }
        }
    }

    return {
        showtimeId: screening.showtimeId,
        date: screening.date,
        bookedSeats: [...new Set(seats)].sort(),
        ...(userId !== undefined && {
            myBookedSeats: [...new Set(mySeats)].filter((seat) => seats.includes(seat)).sort(),
        }),
    };
}
