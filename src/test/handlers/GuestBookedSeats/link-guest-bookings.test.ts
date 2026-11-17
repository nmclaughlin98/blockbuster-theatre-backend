import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import type { OptionalJwtEvent } from '../../../main/lambda/handlers/utils/common';
import { handler } from '../../../main/lambda/handlers/GuestBookedSeats/guest-booked-seats-handler';
import { linkGuestBookings } from '../../../main/lambda/handlers/GuestBookedSeats/link-guest-bookings';

const ddb = mockClient(DynamoDBDocumentClient);
const ses = mockClient(SESv2Client);
const guest = {
    showtimeId: 'show1',
    seatId: 'BOOKING#bk_1',
    recordType: 'BOOKING',
    bookingId: 'bk_1',
    bookingRef: 'BBT-123456',
    customerEmail: 'customer@example.com',
    movieTitle: 'Example',
    date: '2030-01-01',
    time: '12:15',
    screen: '1',
    seats: ['A1'],
    bookedAt: '2029-01-01T00:00:00Z',
};

beforeEach(() => {
    process.env.BOOKINGS_TABLE_NAME = 'current';
    process.env.LEGACY_BOOKINGS_TABLE_NAME = 'legacy';
    process.env.BOOKING_EMAIL_FROM = 'tickets@example.com';
    ddb.reset();
    ses.reset();
    ses.on(SendEmailCommand).resolves({});
});

test('claims all pages once, returns current records, and sends one consolidated email', async () => {
    const second = { ...guest, bookingId: 'bk_2', seatId: 'BOOKING#bk_2', bookingRef: 'BBT-234567' };
    ddb.on(QueryCommand, { TableName: 'current' })
        .resolvesOnce({ Items: [guest], LastEvaluatedKey: { showtimeId: 'show1', seatId: guest.seatId } })
        .resolvesOnce({ Items: [second] });
    ddb.on(QueryCommand, { TableName: 'legacy' }).resolves({ Items: [] });
    ddb.on(UpdateCommand).resolvesOnce({ Attributes: { ...guest, userId: 'user-1' } })
        .resolvesOnce({ Attributes: { ...second, userId: 'user-1' } });

    const result = await linkGuestBookings('user-1', 'customer@example.com');
    expect(result.bookings.map((item) => item.bookingRef)).toEqual(['BBT-123456', 'BBT-234567']);
    expect(result.notificationSent).toBe(true);
    expect(ddb.commandCalls(QueryCommand)[1].args[0].input.ExclusiveStartKey).toBeDefined();
    for (const call of ddb.commandCalls(UpdateCommand)) {
        expect(call.args[0].input).toEqual(expect.objectContaining({
            ConditionExpression: expect.stringContaining('attribute_not_exists(userId) OR userId = :null'),
            UpdateExpression: expect.stringContaining('REMOVE conversionTokenHash, guestAccessToken'),
            ExpressionAttributeValues: expect.objectContaining({ ':userId': 'user-1', ':method': 'AUTO_EMAIL_MATCH' }),
        }));
    }
    const emails = ses.commandCalls(SendEmailCommand);
    expect(emails).toHaveLength(1);
    expect(emails[0].args[0].input.Destination?.ToAddresses).toEqual(['customer@example.com']);
    expect(emails[0].args[0].input.Content?.Simple?.Subject?.Data)
        .toBe("We've linked your guest booking(s) to your Blockbuster Theatre account");
    expect(emails[0].args[0].input.Content?.Simple?.Body?.Text?.Data).toContain('BBT-234567 - Example - 2030-01-01 12:15');
});

test('a concurrent claim is skipped and does not send an email', async () => {
    ddb.on(QueryCommand, { TableName: 'current' }).resolves({ Items: [guest] });
    ddb.on(QueryCommand, { TableName: 'legacy' }).resolves({ Items: [] });
    ddb.on(UpdateCommand).rejects(Object.assign(new Error('race'), { name: 'ConditionalCheckFailedException' }));
    expect(await linkGuestBookings('user-1', 'customer@example.com')).toEqual({ bookings: [], notificationSent: true });
    expect(ses.commandCalls(SendEmailCommand)).toHaveLength(0);
});

test('also claims bookings from the legacy table', async () => {
    const { showtimeId: _showtimeId, ...details } = guest;
    const legacy = { ...details, showingId: 'legacy-showing' };
    ddb.on(QueryCommand, { TableName: 'current' }).resolves({ Items: [] });
    ddb.on(QueryCommand, { TableName: 'legacy' }).resolves({ Items: [legacy] });
    ddb.on(UpdateCommand).resolves({ Attributes: { ...legacy, userId: 'user-1' } });
    const result = await linkGuestBookings('user-1', 'customer@example.com');
    expect(result.bookings.map((item) => item.bookingRef)).toEqual(['BBT-123456']);
    expect(ddb.commandCalls(UpdateCommand)[0].args[0].input.Key).toEqual({
        showingId: 'legacy-showing', seatId: 'BOOKING#bk_1',
    });
});

test('a later sweep does not re-link an already claimed booking even with a stale email index', async () => {
    ddb.on(QueryCommand, { TableName: 'current' }).resolves({ Items: [guest] });
    ddb.on(QueryCommand, { TableName: 'legacy' }).resolves({ Items: [] });
    ddb.on(UpdateCommand)
        .resolvesOnce({ Attributes: { ...guest, userId: 'user-1' } })
        .rejects(Object.assign(new Error('already claimed'), { name: 'ConditionalCheckFailedException' }));
    expect((await linkGuestBookings('user-1', 'customer@example.com')).bookings).toHaveLength(1);
    expect((await linkGuestBookings('user-1', 'customer@example.com')).bookings).toHaveLength(0);
    expect(ses.commandCalls(SendEmailCommand)).toHaveLength(1);
});

test('email failure is reported after successful claims', async () => {
    ddb.on(QueryCommand, { TableName: 'current' }).resolves({ Items: [guest] });
    ddb.on(QueryCommand, { TableName: 'legacy' }).resolves({ Items: [] });
    ddb.on(UpdateCommand).resolves({ Attributes: { ...guest, userId: 'user-1' } });
    ses.on(SendEmailCommand).rejects(new Error('SES unavailable'));
    const result = await linkGuestBookings('user-1', 'customer@example.com');
    expect(result.notificationSent).toBe(false);
    expect(result.bookings).toHaveLength(1);
});

test.each([
    { token_use: 'id', email: 'customer@example.com', email_verified: 'false' },
    { token_use: 'id', email: 'customer@example.com' },
    { token_use: 'access', email: 'customer@example.com', email_verified: 'true' },
])('does not link without a verified ID-token email: %p', async (claims) => {
    ddb.on(QueryCommand).resolves({ Items: [] });
    const result = await handler({
        routeKey: 'GET /api/v1/bookings/account/history',
        requestContext: { requestId: 'test', authorizer: { jwt: { claims: { sub: 'user-1', ...claims } } } },
    } as OptionalJwtEvent);
    expect(typeof result === 'string' ? undefined : JSON.parse(result.body ?? '{}').newlyLinkedBookings).toEqual([]);
    expect(ddb.commandCalls(UpdateCommand)).toHaveLength(0);
    expect(ddb.commandCalls(QueryCommand).every((call) => call.args[0].input.IndexName === 'UserBookings')).toBe(true);
});

test('history returns newly claimed records immediately even before the user index catches up', async () => {
    ddb.on(QueryCommand, { IndexName: 'CustomerEmailBookings', TableName: 'current' }).resolves({ Items: [guest] });
    ddb.on(QueryCommand, { IndexName: 'CustomerEmailBookings', TableName: 'legacy' }).resolves({ Items: [] });
    ddb.on(QueryCommand, { IndexName: 'UserBookings' }).resolves({ Items: [] });
    ddb.on(UpdateCommand).resolves({ Attributes: { ...guest, userId: 'user-1' } });
    const result = await handler({
        routeKey: 'GET /api/v1/bookings/account/history',
        requestContext: { requestId: 'test', authorizer: { jwt: { claims: {
            sub: 'user-1', token_use: 'id', email: ' Customer@Example.com ', email_verified: true,
        } } } },
    } as OptionalJwtEvent);
    if (typeof result === 'string') throw new Error('Expected structured result.');
    const body = JSON.parse(result.body ?? '{}');
    expect(body.newlyLinkedBookings).toEqual(['BBT-123456']);
    expect(body.bookings).toEqual([expect.objectContaining({ bookingId: 'bk_1', bookingRef: 'BBT-123456' })]);
    expect(ddb.commandCalls(QueryCommand, { IndexName: 'CustomerEmailBookings' })[0].args[0].input.ExpressionAttributeValues?.[':email']).toBe('customer@example.com');
});

test('history reports an SES failure without losing the claimed booking', async () => {
    ddb.on(QueryCommand, { IndexName: 'CustomerEmailBookings', TableName: 'current' }).resolves({ Items: [guest] });
    ddb.on(QueryCommand, { IndexName: 'CustomerEmailBookings', TableName: 'legacy' }).resolves({ Items: [] });
    ddb.on(QueryCommand, { IndexName: 'UserBookings' }).resolves({ Items: [] });
    ddb.on(UpdateCommand).resolves({ Attributes: { ...guest, userId: 'user-1' } });
    ses.on(SendEmailCommand).rejects(new Error('SES unavailable'));
    const result = await handler({
        routeKey: 'GET /api/v1/bookings/account/history',
        requestContext: { requestId: 'test', authorizer: { jwt: { claims: {
            sub: 'user-1', token_use: 'id', email: 'customer@example.com', email_verified: 'true',
        } } } },
    } as OptionalJwtEvent);
    if (typeof result === 'string') throw new Error('Expected structured result.');
    expect(JSON.parse(result.body ?? '{}')).toMatchObject({
        newlyLinkedBookings: ['BBT-123456'],
        linkNotificationSent: false,
    });
});
