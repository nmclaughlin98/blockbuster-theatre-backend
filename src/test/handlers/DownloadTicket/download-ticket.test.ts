import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import * as pdfGenerator from '../../../main/lambda/handlers/utils/ticket-pdf-generator';

jest.mock('../../../main/lambda/handlers/utils/common', () => {
    const actual = jest.requireActual('../../../main/lambda/handlers/utils/common');
    return {
        ...actual,
        authenticateOptional: async (headers: Record<string, string | undefined>) => {
            if (!headers.authorization) return undefined;
            if (headers.authorization === 'Bearer invalid') throw new actual.InvalidAuthorizationError();
            return { userId: headers.authorization.replace(/^Bearer /, '') };
        },
    };
});

jest.mock('../../../main/lambda/handlers/utils/ticket-pdf-generator', () => {
    const actual = jest.requireActual<typeof import('../../../main/lambda/handlers/utils/ticket-pdf-generator')>(
        '../../../main/lambda/handlers/utils/ticket-pdf-generator'
    );
    return { ...actual, generateTicketPdf: jest.fn(actual.generateTicketPdf) };
});

process.env.BOOKINGS_TABLE_NAME = 'current-bookings';
process.env.LEGACY_BOOKINGS_TABLE_NAME = 'legacy-bookings';

const ddb = mockClient(DynamoDBDocumentClient);
const { handler } = require('../../../handlers/bookings/download-booking-ticket') as {
    handler: (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyStructuredResultV2>;
};

const booking = {
    showtimeId: 'show-1',
    PK: 'BOOKING#bk_1',
    SK: 'METADATA',
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
    customerEmail: 'alex@example.com',
    tickets: [{ quantity: 2 }, { quantity: 1 }],
    totalAmount: 0,
    currency: 'GBP',
};

function event(userId?: string, bookingId = 'bk_1'): APIGatewayProxyEventV2 {
    return {
        pathParameters: { bookingId },
        headers: userId ? { authorization: `Bearer ${userId}` } : {},
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

test('rejects invalid supplied tokens before accessing bookings', async () => {
    const request = { ...event(), headers: { authorization: 'Bearer invalid' } };
    expect((await handler(request)).statusCode).toBe(401);
    expect(ddb.calls()).toHaveLength(0);
    expect((await handler(event('user-1', ' '))).statusCode).toBe(400);
});

test('downloads an owned booking using the JWT subject and real stored ticket fields', async () => {
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
    expect(ddb.commandCalls(GetCommand)[0].args[0].input).toEqual({
        TableName: 'current-bookings',
        Key: { PK: 'BOOKING#bk_1', SK: 'METADATA' },
        ConsistentRead: true,
    });
});

test('does not disclose another user’s booking', async () => {
    ddb.on(GetCommand).resolves({ Item: { ...booking, userId: 'another-user' } });
    const generate = jest.mocked(pdfGenerator.generateTicketPdf);

    const result = await handler(event('user-1'));
    expect(result.statusCode).toBe(404);
    expect(generate).not.toHaveBeenCalled();
});

test('allows an unlinked guest only with both the reference and email', async () => {
    ddb.on(GetCommand).resolves({ Item: { ...booking, userId: undefined } });
    const request = { ...event(), queryStringParameters: { bookingRef: booking.bookingRef, email: ' ALEX@example.com ' } };
    expect((await handler(request)).statusCode).toBe(200);
    expect((await handler({ ...request, queryStringParameters: { ...request.queryStringParameters, email: 'other@example.com' } })).statusCode).toBe(404);
    ddb.on(GetCommand).resolves({ Item: booking });
    expect((await handler(request)).statusCode).toBe(404);
});

test.each([
    ['missing customer name', { customerName: undefined }],
    ['invalid amount', { totalAmount: -1 }],
    ['mismatched ticket count', { tickets: [{ quantity: 1 }] }],
])('reports %s in stored booking details', async (_label, invalid) => {
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
    ddb.on(GetCommand).rejects(new Error('database unavailable'));
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await handler(event('user-1'));
    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body!)).toEqual({ message: 'Unable to download booking ticket.' });
    expect(log).toHaveBeenCalled();
});
