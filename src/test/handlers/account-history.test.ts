import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';

process.env.BOOKINGS_TABLE_NAME = 'current-bookings';
process.env.LEGACY_BOOKINGS_TABLE_NAME = 'legacy-bookings';

const ddb = mockClient(DynamoDBDocumentClient);
const { handler } = require('../../main/lambda/handlers/guest-booked-seats-handler') as {
    handler: (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;
};

function event(userId?: string): APIGatewayProxyEventV2 {
    return {
        routeKey: 'GET /api/v1/bookings/account/history',
        requestContext: {
            requestId: 'test',
            ...(userId && { authorizer: { jwt: { claims: { sub: userId } } } }),
        },
        queryStringParameters: { userId: 'another-user' },
    } as unknown as APIGatewayProxyEventV2;
}

function body(result: APIGatewayProxyResultV2): Record<string, unknown> {
    if (typeof result === 'string') throw new Error('Expected structured response.');
    return JSON.parse(result.body as string) as Record<string, unknown>;
}

const booking = {
    bookingId: 'bk_1',
    bookingRef: 'BBT-123456',
    movieTitle: 'Example',
    date: '2030-01-01',
    time: '12:15',
    screen: '1',
    seats: ['A1'],
};

beforeEach(() => ddb.reset());

test('requires a verified account', async () => {
    const result = await handler(event());
    expect(typeof result === 'string' ? undefined : result.statusCode).toBe(401);
    expect(ddb.commandCalls(QueryCommand)).toHaveLength(0);
});

test('queries both user indexes through all pages and returns only booking fields', async () => {
    ddb.on(QueryCommand, { TableName: 'current-bookings' })
        .resolvesOnce({
            Items: [{ ...booking, customerEmail: 'private@example.com', conversionTokenHash: 'secret' }],
            LastEvaluatedKey: { showtimeId: 'show1', seatId: 'BOOKING#1', userId: 'user-1', bookedAt: 'now' },
        })
        .resolvesOnce({ Items: [{ ...booking, bookingId: 'bk_2' }] });
    const { bookingRef: _bookingRef, ...legacyBooking } = booking;
    ddb.on(QueryCommand, { TableName: 'legacy-bookings' })
        .resolves({ Items: [{ ...legacyBooking, bookingId: 'bk_legacy' }] });

    const result = await handler(event('user-1'));
    expect(typeof result === 'string' ? undefined : result.statusCode).toBe(200);
    expect(typeof result === 'string' ? undefined : result.headers?.['Cache-Control']).toBe('no-store');
    expect(body(result)).toEqual({ bookings: [booking, { ...booking, bookingId: 'bk_2' }, { ...legacyBooking, bookingId: 'bk_legacy' }] });
    const calls = ddb.commandCalls(QueryCommand);
    expect(calls).toHaveLength(3);
    for (const call of calls) {
        expect(call.args[0].input).toEqual(expect.objectContaining({
            IndexName: 'UserBookings',
            ExpressionAttributeValues: { ':userId': 'user-1', ':booking': 'BOOKING' },
            FilterExpression: 'recordType = :booking',
        }));
    }
    expect(calls[1].args[0].input.ExclusiveStartKey).toBeDefined();
});

test('reports invalid booking data rather than returning an empty history', async () => {
    ddb.on(QueryCommand).resolves({ Items: [{ ...booking, time: 'bad' }] });
    const result = await handler(event('user-1'));
    expect(typeof result === 'string' ? undefined : result.statusCode).toBe(500);
    expect(body(result)).toEqual({ message: 'Unable to list account bookings.' });
});
