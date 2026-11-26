import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 
} from 'aws-lambda';
import {
    DynamoDBDocumentClient,
    GetCommand,
    QueryCommand,
    TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';

process.env.BOOKINGS_TABLE_NAME = 'test-bookings-table';
process.env.SHOWTIME_REGISTRY_TABLE_NAME = 'test-showtime-registry';
process.env.BOOKING_REFERENCES_TABLE_NAME = 'test-references';
process.env.LEGACY_BOOKINGS_TABLE_NAME = 'test-legacy';
process.env.GUEST_CONVERSION_TOKENS_TABLE_NAME = 'test-tokens';
process.env.TABLE_NAME = 'test-movies';

const ddbMock = mockClient(DynamoDBDocumentClient);
let handler: (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;

beforeAll(async () => {
    ({ handler } =
        await import('../../../handlers/bookings/reschedule-booking-record'));
});

const booking = {
    showtimeId: '456000_2026-11-02_1900',
    PK: 'BOOKING#booking-1',
    SK: 'METADATA',
    bookedAt: '2026-10-25T03:19:42.816Z',
    bookingId: 'booking-1',
    bookingRef: 'BBT-958000',
    currency: 'GBP',
    customerEmail: 'customer@example.com',
    customerName: 'Customer',
    date: '2026-11-02',
    day: 'Monday',
    movieId: '456',
    movieTitle: 'A Movie',
    recordType: 'BOOKING',
    screen: '2',
    seats: ['B4', 'B5'],
    tickets: [],
    time: '19:00',
    totalAmount: 20,
    userId: 'user-1',
};

function createEvent(
    queryStringParameters?: Record<string, string>,
    body = JSON.stringify({ newShowtimeId: '456000_2026-11-23_1930' }),
): APIGatewayProxyEventV2 {
    return {
        body,
        pathParameters: { bookingId: booking.bookingId },
        queryStringParameters,
        requestContext: {
            requestId: 'reschedule-request-id',
            authorizer: { jwt: { claims: { sub: 'operator-1' } } },
        },
    } as unknown as APIGatewayProxyEventV2;
}

async function invoke(event: APIGatewayProxyEventV2): Promise<Exclude<APIGatewayProxyResultV2, string>> {
    const result = await handler(event);

    if (typeof result === 'string') throw new Error('Expected a structured response.');

    return result;
}

function responseBody(result: Exclude<APIGatewayProxyResultV2, string>): Record<string, unknown> {
    return JSON.parse(result.body as string) as Record<string, unknown>;
}

describe('Reschedule booking Lambda handler', () => {
    beforeEach(() => {
        ddbMock.reset();
        ddbMock.on(GetCommand, { TableName: 'test-bookings-table' }).resolves({ Item: booking });
        ddbMock.on(GetCommand, { TableName: 'test-movies' }).resolves({
            Item: { movieId: '789', title: 'Another Movie' },
        });
        ddbMock.on(GetCommand, { TableName: 'test-showtime-registry' }).resolves({
            Item: {
                recordType: 'SHOWTIME',
                showtimeId: '456000_2026-11-23_1930',
                movieId: '789',
                date: '2026-11-23',
                day: 'Monday',
                time: '19:30',
                screen: '3',
                status: 'ACTIVE',
            },
        });
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('moves the booking and each seat lock in one transaction', async () => {
        ddbMock.on(TransactWriteCommand).resolves({});

        const result = await invoke(
            createEvent({
                showtimeId: booking.showtimeId,
                bookingRef: booking.bookingRef,
            }),
        );

        expect(result.statusCode).toBe(200);
        expect(responseBody(result)).toMatchObject({
            bookingId: booking.bookingId,
            showtimeId: '456000_2026-11-23_1930',
            date: '2026-11-23',
            day: 'Monday',
            time: '19:30',
            screen: '3',
            movieId: '789',
            movieTitle: 'Another Movie',
            seats: ['B4', 'B5'],
        });

        expect(ddbMock.commandCalls(GetCommand)[0].args[0].input).toMatchObject({
            TableName: 'test-bookings-table',
            Key: { PK: 'BOOKING#booking-1', SK: 'METADATA' },
            ConsistentRead: true,
        });

        const items = ddbMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems!;
        expect(items).toHaveLength(7);
        expect(items[0].Put).toMatchObject({
            Item: {
                showtimeId: '456000_2026-11-23_1930',
                PK: booking.PK,
                SK: booking.SK,
                date: '2026-11-23',
                day: 'Monday',
                time: '19:30',
                screen: '3',
                movieId: '789',
                movieTitle: 'Another Movie',
                totalAmount: 20,
                bookingRef: booking.bookingRef,
                updatedAt: expect.any(String),
            },
            ConditionExpression: expect.stringContaining('#old'),
        });

        expect(items.slice(1, 3).map((item) => item.Delete?.Key)).toEqual([
            { PK: `SHOWTIME#${booking.showtimeId}`, SK: 'SEAT#B4' },
            { PK: `SHOWTIME#${booking.showtimeId}`, SK: 'SEAT#B5' },
        ]);
        expect(items.slice(3, 5).map((item) => item.Put?.Item)).toEqual([
            expect.objectContaining({
                PK: 'SHOWTIME#456000_2026-11-23_1930',
                SK: 'SEAT#B4',
                bookingId: booking.bookingId,
                recordType: 'SEAT',
            }),
            expect.objectContaining({
                PK: 'SHOWTIME#456000_2026-11-23_1930',
                SK: 'SEAT#B5',
                bookingId: booking.bookingId,
                recordType: 'SEAT',
            }),
        ]);

        expect(
            items
                .slice(3, 5)
                .every((item) => item.Put?.ConditionExpression === 'attribute_not_exists(PK)'),
        ).toBe(true);

        expect(items[5].ConditionCheck).toMatchObject({
            TableName: 'test-showtime-registry',
            Key: { registryKey: 'SHOWTIME#456000_2026-11-23_1930' },
        });
        expect(items[6].ConditionCheck).toMatchObject({
            TableName: 'test-movies',
            Key: { movieId: '789' },
        });
        expect(items.slice(1, 3).every((item) =>
            item.Delete?.ConditionExpression?.includes('bookingId')
        )).toBe(true);
    });

    it('requires a booking ID and the new showtime ID', async () => {
        const missingId = createEvent();
        missingId.pathParameters = undefined;
        expect((await invoke(missingId)).statusCode).toBe(400);

        const missingTarget = await invoke(
            createEvent(
                { showtimeId: booking.showtimeId, bookingRef: booking.bookingRef },
                JSON.stringify({}),
            ),
        );

        expect(missingTarget.statusCode).toBe(400);
        expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
    });

    it('returns 404 when no matching booking exists', async () => {
        ddbMock.on(GetCommand, { TableName: 'test-bookings-table' }).resolves({});

        const result = await invoke(
            createEvent({
                showtimeId: booking.showtimeId,
                bookingRef: booking.bookingRef,
            }),
        );

        expect(result.statusCode).toBe(404);
        expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
    });

    it('rejects client-supplied showtime details and a target equal to the current showtime', async () => {
        const query = { showtimeId: booking.showtimeId, bookingRef: booking.bookingRef };
        const sameShowtime = await invoke(
            createEvent(query, JSON.stringify({ newShowtimeId: booking.showtimeId })),
        );

        expect(sameShowtime.statusCode).toBe(400);

        const invalidDate = await invoke(
            createEvent(
                query,
                JSON.stringify({ newShowtimeId: '456000_2026-11-23_1930', date: '2026-02-30' }),
            ),
        );

        expect(invalidDate.statusCode).toBe(400);
        expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
    });

    it('returns 409 when a seat at the target showtime is unavailable', async () => {
        ddbMock.on(TransactWriteCommand).rejects(Object.assign(
            new Error('Transaction cancelled'),
            { name: 'TransactionCanceledException' }
        ));

        const result = await invoke(
            createEvent({
                showtimeId: booking.showtimeId,
                bookingRef: booking.bookingRef,
            }),
        );

        expect(result.statusCode).toBe(409);
        expect(responseBody(result).message).toContain('target seat is unavailable');
    });

    it('preserves a guest conversion token without moving it', async () => {
        const { userId: _userId, ...guest } = booking;
        ddbMock.on(GetCommand, { TableName: 'test-bookings-table' }).resolves({
            Item: { ...guest, conversionTokenHash: 'token-hash' },
        });
        ddbMock.on(TransactWriteCommand).resolves({});

        const result = await invoke(createEvent({ showtimeId: booking.showtimeId, bookingRef: booking.bookingRef }));
        expect(result.statusCode).toBe(200);
        const items = ddbMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems!;
        expect(items[0].Put?.Item?.conversionTokenHash).toBe('token-hash');
        expect(items.some((item) => item.Update?.TableName === 'test-tokens')).toBe(false);
    });

    it('rejects unauthenticated callers before looking up a booking', async () => {
        const event = createEvent({ showtimeId: booking.showtimeId, bookingRef: booking.bookingRef });
        event.requestContext = { requestId: 'request' } as APIGatewayProxyEventV2['requestContext'];
        expect((await invoke(event)).statusCode).toBe(401);
        expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
    });

    it('does not move the booking when the target showtime is missing or cancelled', async () => {
        for (const item of [undefined, { status: 'CANCELLED' }]) {
            ddbMock.on(GetCommand, { TableName: 'test-showtime-registry' }).resolves({ Item: item });
            const result = await invoke(createEvent({ showtimeId: booking.showtimeId, bookingRef: booking.bookingRef }));
            expect(result.statusCode).toBe(404);
        }
        expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
    });

    it('surfaces transaction failures that are not conditional conflicts', async () => {
        ddbMock.on(TransactWriteCommand).rejects(Object.assign(
            new Error('throughput exceeded'),
            { name: 'TransactionCanceledException', CancellationReasons: [{ Code: 'ProvisionedThroughputExceeded' }] }
        ));
        const result = await invoke(createEvent({ showtimeId: booking.showtimeId, bookingRef: booking.bookingRef }));
        expect(result.statusCode).toBe(500);
    });
});
