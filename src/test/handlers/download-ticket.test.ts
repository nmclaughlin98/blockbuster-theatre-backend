import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import * as pdfGenerator from '../../main/lambda/handlers/utils/ticket-pdf-generator';

jest.mock('../../main/lambda/handlers/utils/ticket-pdf-generator', () => {
    const actual = jest.requireActual<typeof import('../../main/lambda/handlers/utils/ticket-pdf-generator')>(
        '../../main/lambda/handlers/utils/ticket-pdf-generator'
    );
    return { ...actual, generateTicketPdf: jest.fn(actual.generateTicketPdf) };
});

process.env.BOOKINGS_TABLE_NAME = 'current-bookings';
process.env.LEGACY_BOOKINGS_TABLE_NAME = 'legacy-bookings';

const ddb = mockClient(DynamoDBDocumentClient);
const { handler } = require('../../main/lambda/handlers/download-ticket-handler') as {
    handler: (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyStructuredResultV2>;
};

const booking = {
    showtimeId: 'show-1',
    seatId: 'BOOKING#bk_1',
    recordType: 'BOOKING',
    bookingId: 'bk_1',
    userId: 'user-1',
    bookingRef: 'BBT-123456',
    movieTitle: 'Example Movie',
    date: '2030-01-01',
    time: '12:15',
    screen: '1',
    seats: ['A1', 'A2', 'A3'],
    customerName: 'Alex Smith',
    tickets: [{ quantity: 2 }, { quantity: 1 }],
    totalAmount: 0,
    currency: 'GBP',
};

function event(userId?: string, bookingId = 'bk_1'): APIGatewayProxyEventV2 {
    return {
        pathParameters: { bookingId },
        requestContext: {
            requestId: 'ticket-test',
            ...(userId && { authorizer: { jwt: { claims: { sub: userId } } } }),
        },
    } as unknown as APIGatewayProxyEventV2;
}

beforeEach(() => {
    ddb.reset();
    jest.restoreAllMocks();
    jest.clearAllMocks();
});

test('requires a verified JWT subject before accessing bookings', async () => {
    const request = {
        ...event(),
        requestContext: { requestId: 'ticket-test', authorizer: { claims: { sub: 'forged' } } },
    } as unknown as APIGatewayProxyEventV2;
    expect((await handler(request)).statusCode).toBe(401);
    expect(ddb.calls()).toHaveLength(0);
    expect((await handler(event('user-1', ' '))).statusCode).toBe(400);
});

test('downloads an owned booking using the JWT subject and real stored ticket fields', async () => {
    ddb.on(QueryCommand).resolvesOnce({
        Items: [],
        LastEvaluatedKey: { showtimeId: 'earlier', seatId: 'A1', userId: 'user-1', bookedAt: 'now' },
    }).resolvesOnce({ Items: [{ showtimeId: 'show-1', seatId: 'BOOKING#bk_1' }] });
    ddb.on(GetCommand).resolves({ Item: booking });
    const generate = jest.mocked(pdfGenerator.generateTicketPdf);

    const result = await handler(event('user-1'));

    expect(result.statusCode).toBe(200);
    expect(result.isBase64Encoded).toBe(true);
    expect(result.headers).toEqual(expect.objectContaining({
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="Example_Movie_BBT-123456.pdf"',
        'Cache-Control': 'no-store',
    }));
    const pdf = Buffer.from(result.body!, 'base64');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(result.headers?.['Content-Length']).toBe(String(pdf.length));
    expect(generate).toHaveBeenCalledWith({
        bookingRef: 'BBT-123456',
        movieTitle: 'Example Movie',
        date: '2030-01-01',
        time: '12:15',
        screen: '1',
        seats: ['A1', 'A2', 'A3'],
        guestName: 'Alex Smith',
        ticketCount: 3,
        totalAmount: 0,
        currency: 'GBP',
    });
    const queries = ddb.commandCalls(QueryCommand);
    expect(queries).toHaveLength(2);
    expect(queries[0].args[0].input).toEqual(expect.objectContaining({
        TableName: 'current-bookings',
        IndexName: 'UserBookings',
        ExpressionAttributeValues: {
            ':userId': 'user-1', ':booking': 'BOOKING', ':bookingId': 'bk_1',
        },
    }));
    expect(queries[1].args[0].input.ExclusiveStartKey).toBeDefined();
    expect(ddb.commandCalls(GetCommand)[0].args[0].input).toEqual({
        TableName: 'current-bookings',
        Key: { showtimeId: 'show-1', seatId: 'BOOKING#bk_1' },
        ConsistentRead: true,
    });
});

test('does not disclose a booking when the index has stale ownership', async () => {
    ddb.on(QueryCommand, { TableName: 'current-bookings' })
        .resolves({ Items: [{ showtimeId: 'show-1', seatId: 'BOOKING#bk_1' }] });
    ddb.on(QueryCommand, { TableName: 'legacy-bookings' }).resolves({ Items: [] });
    ddb.on(GetCommand).resolves({ Item: { ...booking, userId: 'another-user' } });
    const generate = jest.mocked(pdfGenerator.generateTicketPdf);

    const result = await handler(event('user-1'));
    expect(result.statusCode).toBe(404);
    expect(generate).not.toHaveBeenCalled();
});

test('finds an owned converted booking in the legacy table', async () => {
    ddb.on(QueryCommand, { TableName: 'current-bookings' }).resolves({ Items: [] });
    ddb.on(QueryCommand, { TableName: 'legacy-bookings' })
        .resolves({ Items: [{ showingId: 'legacy-show', seatId: 'BOOKING#bk_1' }] });
    ddb.on(GetCommand).resolves({ Item: { ...booking, showingId: 'legacy-show' } });

    expect((await handler(event('user-1'))).statusCode).toBe(200);
    expect(ddb.commandCalls(GetCommand)[0].args[0].input).toEqual({
        TableName: 'legacy-bookings',
        Key: { showingId: 'legacy-show', seatId: 'BOOKING#bk_1' },
        ConsistentRead: true,
    });
});

test.each([
    ['missing customer name', { customerName: undefined }],
    ['invalid amount', { totalAmount: -1 }],
    ['mismatched ticket count', { tickets: [{ quantity: 1 }] }],
])('reports %s in stored booking details', async (_label, invalid) => {
    ddb.on(QueryCommand).resolves({ Items: [{ showtimeId: 'show-1', seatId: 'BOOKING#bk_1' }] });
    ddb.on(GetCommand).resolves({ Item: { ...booking, ...invalid } });
    const generate = jest.mocked(pdfGenerator.generateTicketPdf);
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await handler(event('user-1'));
    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body!)).toEqual({ message: 'Unable to download booking ticket.' });
    expect(generate).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
});

test('reports database failures without exposing the underlying error', async () => {
    ddb.on(QueryCommand).rejects(new Error('database unavailable'));
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await handler(event('user-1'));
    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body!)).toEqual({ message: 'Unable to download booking ticket.' });
    expect(log).toHaveBeenCalled();
});
