import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
    DynamoDBDocumentClient,
    GetCommand,
    QueryCommand,
    TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
    AdminCreateUserCommand,
    AdminGetUserCommand,
    AdminInitiateAuthCommand,
    AdminSetUserPasswordCommand,
    CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { createHash } from 'crypto';
import { mockClient } from 'aws-sdk-client-mock';

process.env.TABLE_NAME = 'test-movies';
process.env.PRICING_TABLE_NAME = 'test-pricing';
process.env.OFFERS_TABLE_NAME = 'test-offers';
process.env.BOOKINGS_TABLE_NAME = 'test-bookings';
process.env.LEGACY_BOOKINGS_TABLE_NAME = 'test-legacy-bookings';
process.env.SHOWTIME_REGISTRY_TABLE_NAME = 'test-showtime-registry';
process.env.BOOKING_REFERENCES_TABLE_NAME = 'test-booking-references';
process.env.GUEST_CONVERSION_TOKENS_TABLE_NAME = 'test-conversion-tokens';
process.env.USER_POOL_ID = 'test-pool';
process.env.USER_POOL_CLIENT_ID = 'test-client';
process.env.BOOKING_EMAIL_FROM = 'bookings@example.com';

const ddbMock = mockClient(DynamoDBDocumentClient);
const cognitoMock = mockClient(CognitoIdentityProviderClient);
const sesMock = mockClient(SESv2Client);
type Handler = (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;
const { handler: guestBookingHandler } = require(
    '../../main/lambda/handlers/guest-booking-handler'
) as { handler: Handler };
const { handler: bookedSeatsHandler } = require(
    '../../main/lambda/handlers/guest-booked-seats-handler'
) as { handler: Handler };
const { handler: guestConversionHandler } = require(
    '../../main/lambda/handlers/guest-conversion-handler'
) as { handler: Handler };

const time = '12:15';
const screen = '5';
const conversionToken = `cnv_tok_${'a'.repeat(43)}`;
const tokenHash = createHash('sha256').update(conversionToken).digest('hex');

function upcomingSunday(): string {
    const value = new Date();
    value.setUTCDate(value.getUTCDate() + 7);
    while (value.getUTCDay() !== 0) value.setUTCDate(value.getUTCDate() + 1);
    return value.toISOString().slice(0, 10);
}

const date = upcomingSunday();
const showtimeId = `559924_${date}_1215`;
const legacyShowingId = `424694#${date}#${time}`;
const registryRecord = {
    registryKey: `SHOWTIME#${showtimeId}`,
    recordType: 'SHOWTIME',
    showtimeId,
    movieId: '424694',
    date,
    day: 'Sunday',
    screen,
    time,
};

const movie = {
    tmdbId: '424694',
    slug: 'bohemian-rhapsody',
    title: 'Bohemian Rhapsody',
    visible: true,
    isComingSoon: false,
    genres: ['Drama'],
    mainGenre: 'Drama',
    rating: '12A',
    score: 8,
    runtime: 134,
    releaseDate: '2018-10-24T00:00:00.000Z',
    poster: 'https://example.com/poster.jpg',
    still: 'https://example.com/still.jpg',
    starring: ['Actor'],
    director: 'Director',
    synopsis: 'Synopsis',
    tagline: 'Tagline',
    trailer: 'https://example.com/trailer',
    showtimes: { Sunday: [{ screen, time }] },
    GSI1PK: 'MOVIE',
    GSI1SK: '2018-10-24#424694',
};

const pricing = {
    pricingId: 'STANDARD_RATES',
    name: 'Standard Rates',
    currency: 'GBP',
    ticketTiers: [
        { id: 'adult', label: 'Standard Adult', description: 'Adult admission', price: 9.5 },
        { id: 'child', label: 'Child Ticket', description: 'Child admission', price: 6 },
    ],
};

function event(body?: unknown, query?: Record<string, string>): APIGatewayProxyEventV2 {
    return {
        body: body === undefined ? undefined : JSON.stringify(body),
        queryStringParameters: query,
        requestContext: { requestId: 'guest-booking-test' },
    } as unknown as APIGatewayProxyEventV2;
}

function responseBody(result: APIGatewayProxyResultV2): Record<string, unknown> {
    if (typeof result === 'string') throw new Error('Expected a structured response.');
    return JSON.parse(result.body as string) as Record<string, unknown>;
}

function mockPricing(): void {
    ddbMock.on(QueryCommand, { TableName: 'test-movies' }).resolves({ Items: [movie] });
    ddbMock.on(GetCommand, { TableName: 'test-pricing' }).resolves({ Item: pricing });
}

function mockShowtimeResolution(): void {
    ddbMock
        .on(GetCommand, { TableName: 'test-showtime-registry' })
        .callsFake((input) => ({
            Item:
                input.Key?.registryKey === `SHOWTIME#${showtimeId}`
                    ? registryRecord
                    : undefined,
        }));
}

function validGuestPayload(): Record<string, unknown> {
    return {
        showtimeId,
        date,
        seats: ['F10', 'F11'],
        email: ' CUSTOMER@example.com ',
        customerName: ' Niall McLaughlin ',
        tickets: [
            { tierId: 'adult', quantity: 1 },
            { tierId: 'child', quantity: 1 },
        ],
    };
}

function mockConversionRecords(overrides: Record<string, unknown> = {}): void {
    ddbMock
        .on(GetCommand, { TableName: 'test-conversion-tokens' })
        .resolves({
            Item: {
                tokenHash,
                bookingId: 'bk_123',
                showtimeId,
                customerEmail: 'customer@example.com',
                expiresAt: Math.floor(Date.now() / 1000) + 600,
                ...overrides,
            },
        });
    ddbMock.on(GetCommand, { TableName: 'test-bookings' }).resolves({
        Item: {
            recordType: 'BOOKING',
            customerEmail: 'customer@example.com',
        },
    });
}

describe('unpaid guest bookings', () => {
    beforeEach(() => {
        ddbMock.reset();
        cognitoMock.reset();
        sesMock.reset();
        mockShowtimeResolution();
        sesMock.on(SendEmailCommand).resolves({});
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => jest.restoreAllMocks());

    it('creates one unpaid booking with a ticket breakdown and a calculated total', async () => {
        mockPricing();
        ddbMock.on(TransactWriteCommand).resolves({});

        const result = await guestBookingHandler(event(validGuestPayload()));

        expect(result).toMatchObject({ statusCode: 201 });
        const response = responseBody(result);
        expect(response).toMatchObject({
            showtimeId,
            movieTitle: 'Bohemian Rhapsody',
            date,
            seats: ['F10', 'F11'],
            totalAmount: 15.5,
            currency: 'GBP',
            customerEmail: 'customer@example.com',
            tickets: [
                { tierId: 'adult', quantity: 1, unitPrice: 9.5, subtotal: 9.5 },
                { tierId: 'child', quantity: 1, unitPrice: 6, subtotal: 6 },
            ],
        });
        expect(response.bookingId).toEqual(expect.stringMatching(/^bk_/));
        expect(response.conversionToken).toEqual(expect.stringMatching(/^cnv_tok_/));
        expect(response.bookingRef).toEqual(expect.stringMatching(/^BBT-\d{6}$/));
        expect(response.confirmationEmailSent).toBe(true);

        const transaction = ddbMock.commandCalls(TransactWriteCommand)[0].args[0].input;
        expect(transaction.TransactItems).toHaveLength(7);
        const writes = transaction.TransactItems?.map((item) => item.Put?.Item).filter(Boolean);
        expect(writes).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    recordType: 'SEAT',
                    showtimeId,
                    seatId: 'F10',
                }),
                expect.objectContaining({
                    recordType: 'SEAT',
                    showtimeId,
                    seatId: 'F11',
                }),
                expect.objectContaining({
                    recordType: 'BOOKING',
                    showtimeId,
                    seats: ['F10', 'F11'],
                    customerEmail: 'customer@example.com',
                    customerName: 'Niall McLaughlin',
                    totalAmount: 15.5,
                }),
                expect.objectContaining({
                    tokenHash: createHash('sha256')
                        .update(response.conversionToken as string)
                        .digest('hex'),
                }),
                expect.objectContaining({ bookingRef: response.bookingRef }),
            ])
        );
        expect(transaction.TransactItems?.[0].Put?.Item?.showingId).toBeUndefined();
        expect(sesMock.commandCalls(SendEmailCommand)[0].args[0].input).toMatchObject({
            Destination: { ToAddresses: ['customer@example.com'] },
            Content: { Simple: { Attachments: [{ ContentId: 'booking-reference-qr' }] } },
        });
        expect(cognitoMock.calls()).toHaveLength(0);
    });

    it('accepts the unpaid payload without paymentToken and never calls a payment service', async () => {
        mockPricing();
        ddbMock.on(TransactWriteCommand).resolves({});

        const payload = validGuestPayload();
        delete payload.paymentToken;
        const result = await guestBookingHandler(event(payload));

        expect(result).toMatchObject({ statusCode: 201 });
        expect(responseBody(result).totalAmount).toBe(15.5);
        expect(cognitoMock.calls()).toHaveLength(0);
    });

    it('uses the same showtimeId and date for booked-seat lookup and reservation', async () => {
        ddbMock.on(QueryCommand, { TableName: 'test-bookings' }).resolves({
            Items: [{ seatId: 'F10' }, { seatId: 'F11' }],
        });
        ddbMock.on(QueryCommand, { TableName: 'test-legacy-bookings' }).resolves({ Items: [] });

        const result = await bookedSeatsHandler(
            event(undefined, { showtimeId, date })
        );

        expect(result).toMatchObject({ statusCode: 200 });
        expect(responseBody(result)).toEqual({
            showtimeId,
            date,
            bookedSeats: ['F10', 'F11'],
        });
        expect(ddbMock.commandCalls(QueryCommand)[0].args[0].input).toMatchObject({
            TableName: 'test-bookings',
            KeyConditionExpression: 'showtimeId = :key',
            ExpressionAttributeValues: { ':key': showtimeId },
            FilterExpression: 'recordType = :seat',
        });
        expect(ddbMock.commandCalls(QueryCommand)[1].args[0].input).toMatchObject({
            TableName: 'test-legacy-bookings',
            KeyConditionExpression: 'showingId = :key',
            ExpressionAttributeValues: { ':key': legacyShowingId },
        });
    });

    it('rejects an unknown showtime ID before pricing or writing', async () => {
        mockPricing();

        const payload = validGuestPayload();
        payload.showtimeId = `111111_${date}_1215`;
        const result = await guestBookingHandler(event(payload));

        expect(result).toMatchObject({ statusCode: 404 });
        expect(responseBody(result).message).toBe('Showtime not found.');
        expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
        expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
    });

    it('rejects invalid seat IDs and mismatched ticket quantities', async () => {
        const invalidSeat = validGuestPayload();
        invalidSeat.seats = ['F12'];
        expect(await guestBookingHandler(event(invalidSeat))).toMatchObject({ statusCode: 400 });

        const mismatch = validGuestPayload();
        mismatch.tickets = [{ tierId: 'adult', quantity: 1 }];
        expect(await guestBookingHandler(event(mismatch))).toMatchObject({ statusCode: 400 });
        expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
    });

    it('rejects invalid guest details before pricing or writing', async () => {
        const invalidEmail = validGuestPayload();
        invalidEmail.email = 'not-an-email';
        expect(await guestBookingHandler(event(invalidEmail))).toMatchObject({
            statusCode: 400,
        });

        const missingName = validGuestPayload();
        missingName.customerName = ' ';
        expect(await guestBookingHandler(event(missingName))).toMatchObject({
            statusCode: 400,
        });
        expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
        expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
    });

    it('returns HTTP 409 when any requested seat was reserved concurrently', async () => {
        mockPricing();
        ddbMock.on(TransactWriteCommand).rejects(
            Object.assign(new Error('Transaction cancelled'), {
                name: 'TransactionCanceledException',
                CancellationReasons: [
                    { Code: 'None' },
                    { Code: 'ConditionalCheckFailed' },
                    { Code: 'None' },
                    { Code: 'None' },
                    { Code: 'None' },
                    { Code: 'None' },
                    { Code: 'None' },
                ],
            })
        );

        const result = await guestBookingHandler(event(validGuestPayload()));

        expect(result).toMatchObject({ statusCode: 409 });
        expect(responseBody(result)).toEqual({
            message: 'One or more selected seats are no longer available.',
        });
    });
});

describe('guest account conversion', () => {
    beforeEach(() => {
        ddbMock.reset();
        cognitoMock.reset();
        mockShowtimeResolution();
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => jest.restoreAllMocks());

    it('creates a Cognito account, associates the booking, and consumes the token', async () => {
        mockConversionRecords();
        cognitoMock.on(AdminCreateUserCommand).resolves({
            User: { Attributes: [{ Name: 'sub', Value: 'user-sub-123' }] },
        });
        cognitoMock.on(AdminSetUserPasswordCommand).resolves({});
        cognitoMock.on(AdminInitiateAuthCommand).resolves({
            AuthenticationResult: {
                AccessToken: 'access-token-response',
                RefreshToken: 'refresh-token-response',
            },
        });
        cognitoMock.on(AdminGetUserCommand).resolves({
            UserAttributes: [{ Name: 'sub', Value: 'user-sub-123' }],
        });
        ddbMock.on(TransactWriteCommand).resolves({});

        const result = await guestConversionHandler(
            event({ conversionToken, password: 'SuperSecretPassword123!' })
        );

        expect(result).toMatchObject({ statusCode: 200 });
        expect(responseBody(result)).toEqual({
            userId: 'user-sub-123',
            email: 'customer@example.com',
            accessToken: 'access-token-response',
            refreshToken: 'refresh-token-response',
        });
        expect(cognitoMock.commandCalls(AdminSetUserPasswordCommand)[0].args[0].input)
            .toMatchObject({ Permanent: true });
        expect(cognitoMock.commandCalls(AdminInitiateAuthCommand)[0].args[0].input)
            .toMatchObject({ AuthFlow: 'ADMIN_USER_PASSWORD_AUTH' });
        const transaction = ddbMock.commandCalls(TransactWriteCommand)[0].args[0].input;
        expect(transaction.TransactItems?.[0].Update?.ConditionExpression)
            .toContain('attribute_not_exists(consumedAt)');
        expect(transaction.TransactItems?.[1].Update?.Key).toEqual({
            showtimeId,
            seatId: 'BOOKING#bk_123',
        });
        expect(JSON.stringify(transaction)).not.toContain('SuperSecretPassword123!');
        expect(JSON.stringify(transaction)).not.toContain(conversionToken);
    });

    it('rejects an invalid token without calling Cognito', async () => {
        ddbMock.on(GetCommand, { TableName: 'test-conversion-tokens' }).resolves({});

        const result = await guestConversionHandler(
            event({ conversionToken, password: 'SuperSecretPassword123!' })
        );

        expect(result).toMatchObject({ statusCode: 404 });
        expect(cognitoMock.calls()).toHaveLength(0);
    });

    it('rejects an expired token without calling Cognito', async () => {
        mockConversionRecords({ expiresAt: Math.floor(Date.now() / 1000) - 1 });

        const result = await guestConversionHandler(
            event({ conversionToken, password: 'SuperSecretPassword123!' })
        );

        expect(result).toMatchObject({ statusCode: 410 });
        expect(cognitoMock.calls()).toHaveLength(0);
    });

    it('rejects a consumed token without calling Cognito', async () => {
        mockConversionRecords({ consumedAt: new Date().toISOString() });

        const result = await guestConversionHandler(
            event({ conversionToken, password: 'SuperSecretPassword123!' })
        );

        expect(result).toMatchObject({ statusCode: 409 });
        expect(cognitoMock.calls()).toHaveLength(0);
    });
});
