import type {
    APIGatewayProxyEventV2,
    APIGatewayProxyResultV2,
} from 'aws-lambda';
import {
    DynamoDBDocumentClient,
    QueryCommand,
    TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';

process.env.BOOKINGS_TABLE_NAME = 'test-bookings-table';

const ddbMock = mockClient(DynamoDBDocumentClient);
const { handler } = require('../../../main/lambda/handlers/RescheduleBooking/reschedule-booking-handler') as {
    handler: (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;
};

const booking = {
    showtimeId: '456000_2026-11-02_1900',
    seatId: 'BOOKING#booking-1',
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
    body = JSON.stringify({ newShowtimeId: '456000_2026-11-23_1930' })
): APIGatewayProxyEventV2 {
    return {
        body,
        queryStringParameters,
        requestContext: { requestId: 'reschedule-request-id' },
    } as unknown as APIGatewayProxyEventV2;
}

async function invoke(event: APIGatewayProxyEventV2): Promise<Exclude<APIGatewayProxyResultV2, string>> {
    const result = await handler(event);
    if (typeof result === 'string') throw new Error('Expected a structured response.');
    return result;
}

function responseBody(
    result: Exclude<APIGatewayProxyResultV2, string>
): Record<string, unknown> {
    return JSON.parse(result.body as string) as Record<string, unknown>;
}

describe('Reschedule booking Lambda handler', () => {
    beforeEach(() => {
        ddbMock.reset();
        ddbMock.on(QueryCommand).resolves({ Items: [booking] });
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('moves the booking and each seat lock in one transaction', async () => {
        ddbMock.on(TransactWriteCommand).resolves({});

        const result = await invoke(createEvent({
            showtimeId: booking.showtimeId,
            bookingRef: booking.bookingRef,
        }));

        expect(result.statusCode).toBe(200);
        expect(responseBody(result)).toMatchObject({
            bookingId: booking.bookingId,
            showtimeId: '456000_2026-11-23_1930',
            date: '2026-11-23',
            day: 'Monday',
            time: '19:30',
            screen: '2',
            seats: ['B4', 'B5'],
        });
        expect(ddbMock.commandCalls(QueryCommand)[0].args[0].input).toMatchObject({
            TableName: 'test-bookings-table',
            KeyConditionExpression: '#showtimeId = :showtimeId AND begins_with(#seatId, :bookingPrefix)',
            FilterExpression: '#bookingRef = :bookingRef',
            ConsistentRead: true,
        });
        const items = ddbMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems!;
        expect(items).toHaveLength(6);
        expect(items[0].Delete).toMatchObject({
            Key: { showtimeId: booking.showtimeId, seatId: booking.seatId },
            ConditionExpression: 'attribute_exists(seatId)',
        });
        expect(items[1].Put).toMatchObject({
            Item: {
                showtimeId: '456000_2026-11-23_1930',
                seatId: booking.seatId,
                date: '2026-11-23',
                day: 'Monday',
                time: '19:30',
                screen: '2',
                updatedAt: expect.any(String),
            },
            ConditionExpression: 'attribute_not_exists(seatId)',
        });
        expect(items.slice(2, 4).map((item) => item.Delete?.Key?.seatId)).toEqual(['B4', 'B5']);
        expect(items.slice(4).map((item) => item.Put?.Item)).toEqual([
            expect.objectContaining({
                showtimeId: '456000_2026-11-23_1930',
                seatId: 'B4',
                bookingId: booking.bookingId,
                recordType: 'SEAT',
            }),
            expect.objectContaining({
                showtimeId: '456000_2026-11-23_1930',
                seatId: 'B5',
                bookingId: booking.bookingId,
                recordType: 'SEAT',
            }),
        ]);
        expect(items.slice(4).every((item) =>
            item.Put?.ConditionExpression === 'attribute_not_exists(seatId)'
        )).toBe(true);
    });

    it('requires both query parameters and the new showtime ID', async () => {
        const missingQuery = await invoke(createEvent());
        expect(missingQuery.statusCode).toBe(400);

        const missingTarget = await invoke(createEvent(
            { showtimeId: booking.showtimeId, bookingRef: booking.bookingRef },
            JSON.stringify({})
        ));
        expect(missingTarget.statusCode).toBe(400);
        expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
    });

    it('returns 404 when no matching booking exists', async () => {
        ddbMock.on(QueryCommand).resolves({ Items: [] });

        const result = await invoke(createEvent({
            showtimeId: booking.showtimeId,
            bookingRef: booking.bookingRef,
        }));

        expect(result.statusCode).toBe(404);
        expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
    });

    it('rejects invalid dates and a target equal to the current showtime', async () => {
        const query = { showtimeId: booking.showtimeId, bookingRef: booking.bookingRef };
        const sameShowtime = await invoke(createEvent(
            query,
            JSON.stringify({ newShowtimeId: booking.showtimeId })
        ));
        expect(sameShowtime.statusCode).toBe(400);

        const invalidDate = await invoke(createEvent(
            query,
            JSON.stringify({ newShowtimeId: '456000_2026-11-23_1930', date: '2026-02-30' })
        ));
        expect(invalidDate.statusCode).toBe(400);
        expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
    });

    it('returns 409 when a seat at the target showtime is unavailable', async () => {
        ddbMock.on(TransactWriteCommand).rejects(Object.assign(
            new Error('Transaction cancelled'),
            { name: 'TransactionCanceledException' }
        ));

        const result = await invoke(createEvent({
            showtimeId: booking.showtimeId,
            bookingRef: booking.bookingRef,
        }));

        expect(result.statusCode).toBe(409);
        expect(responseBody(result).message).toContain('seats are unavailable');
    });
});
