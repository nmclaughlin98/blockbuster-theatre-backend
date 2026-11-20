import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import type { OptionalJwtEvent } from '../../../main/lambda/handlers/utils/common';
import { handler } from '../../../handlers/bookings/list-booking-records';
import { linkGuestBookings } from '../../../services/bookings/link-guest-bookings';

const ddb = mockClient(DynamoDBDocumentClient);
const ses = mockClient(SESv2Client);
const ssm = mockClient(SSMClient);
const parameterName = '/test/ALLOW_LINK_BOOKINGS';
const originalParameterName = process.env.ALLOW_LINK_BOOKINGS_PARAMETER_NAME;
const futureKey = 'customerEmail = :email AND #date > :cutoffDate';
const todayKey = 'customerEmail = :email AND #date = :cutoffDate';
const guest = {
    showtimeId: 'show1',
    seatId: 'BOOKING#bk_1',
    recordType: 'BOOKING',
    bookingId: 'bk_1',
    bookingRef: 'BBT-123456',
    customerEmail: 'customer@example.com',
    movieId: 'movie-1',
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
    process.env.ALLOW_LINK_BOOKINGS_PARAMETER_NAME = parameterName;
    ddb.reset();
    ses.reset();
    ssm.reset();
    ssm.on(GetParameterCommand, { Name: parameterName }).resolves({ Parameter: { Value: 'false' } });
    ddb.on(QueryCommand, { KeyConditionExpression: todayKey }).resolves({ Items: [] });
    ses.on(SendEmailCommand).resolves({});
});

afterAll(() => {
    if (originalParameterName === undefined) delete process.env.ALLOW_LINK_BOOKINGS_PARAMETER_NAME;
    else process.env.ALLOW_LINK_BOOKINGS_PARAMETER_NAME = originalParameterName;
});

test('claims all pages once, returns current records, and sends one consolidated email', async () => {
    const second = { ...guest, bookingId: 'bk_2', seatId: 'BOOKING#bk_2', bookingRef: 'BBT-234567' };
    const differentShowtime = {
        ...guest,
        showtimeId: 'show2',
        bookingId: 'bk_3',
        seatId: 'BOOKING#bk_3',
        bookingRef: 'BBT-345678',
        movieId: 'movie-2',
        movieTitle: 'Other',
        date: '2030-01-02',
        time: '14:30',
        screen: '2',
    };
    ddb.on(QueryCommand, { TableName: 'current', KeyConditionExpression: futureKey })
        .resolvesOnce({ Items: [guest], LastEvaluatedKey: { showtimeId: 'show1', seatId: guest.seatId } })
        .resolvesOnce({ Items: [second, differentShowtime] });
    ddb.on(QueryCommand, { TableName: 'legacy', KeyConditionExpression: futureKey }).resolves({ Items: [] });
    ddb.on(UpdateCommand).resolvesOnce({ Attributes: { ...guest, userId: 'user-1' } })
        .resolvesOnce({ Attributes: { ...second, userId: 'user-1' } })
        .resolvesOnce({ Attributes: { ...differentShowtime, userId: 'user-1' } });

    const result = await linkGuestBookings('user-1', 'customer@example.com');
    expect(result.bookings.map((item) => item.bookingRef)).toEqual([
        'BBT-123456',
        'BBT-234567',
        'BBT-345678',
    ]);
    expect(result.notificationSent).toBe(true);
    expect(ddb.commandCalls(QueryCommand)[1].args[0].input.ExclusiveStartKey).toBeDefined();
    for (const call of ddb.commandCalls(QueryCommand)) {
        expect(call.args[0].input).toEqual(expect.objectContaining({
            IndexName: 'CustomerEmailUpcomingBookings',
            KeyConditionExpression: expect.stringMatching(/#date (?:>|=) :cutoffDate/),
            ExpressionAttributeValues: expect.objectContaining({ ':email': 'customer@example.com' }),
        }));
        expect(call.args[0].input.FilterExpression).not.toContain('#date');
    }
    const updateCalls = ddb.commandCalls(UpdateCommand);
    for (const call of updateCalls) {
        expect(call.args[0].input).toEqual(expect.objectContaining({
            ConditionExpression: expect.stringContaining('movieId = :movieId AND #date = :date AND #time = :time AND screen = :screen'),
            UpdateExpression: expect.stringContaining('REMOVE conversionTokenHash, guestAccessToken'),
            ExpressionAttributeValues: expect.objectContaining({
                ':userId': 'user-1',
                ':method': 'AUTO_EMAIL_MATCH',
            }),
        }));
    }
    expect(updateCalls.map((call) => call.args[0].input.ExpressionAttributeValues)).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                ':bookingId': 'bk_1',
                ':movieId': 'movie-1',
                ':date': '2030-01-01',
                ':time': '12:15',
                ':screen': '1',
            }),
            expect.objectContaining({
                ':bookingId': 'bk_3',
                ':movieId': 'movie-2',
                ':date': '2030-01-02',
                ':time': '14:30',
                ':screen': '2',
            }),
        ])
    );
    const emails = ses.commandCalls(SendEmailCommand);
    expect(emails).toHaveLength(1);
    expect(emails[0].args[0].input.Destination?.ToAddresses).toEqual(['customer@example.com']);
    expect(emails[0].args[0].input.Content?.Simple?.Subject?.Data)
        .toBe("We've linked your guest booking(s) to your Blockbuster Theatre account");
    const email = emails[0].args[0].input.Content?.Simple?.Body?.Text?.Data;
    expect(email).toContain('Example - 2030-01-01 12:15\nBBT-123456\nBBT-234567');
    expect(email).toContain('Other - 2030-01-02 14:30\nBBT-345678');
});

test('does not claim past showtimes returned by a stale upcoming-bookings index', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2030-01-01T12:15:30.000Z'));
    const pastDate = { ...guest, bookingRef: 'PAST-DATE', date: '2030-01-01', time: '12:15' };
    const pastDay = {
        ...guest,
        bookingId: 'bk_2',
        seatId: 'BOOKING#bk_2',
        bookingRef: 'PAST-DAY',
        date: '2029-12-31',
    };
    const upcoming = {
        ...guest,
        bookingId: 'bk_3',
        seatId: 'BOOKING#bk_3',
        bookingRef: 'FUTURE-REF',
        time: '12:16',
    };
    ddb.on(QueryCommand, { TableName: 'current', KeyConditionExpression: todayKey })
        .resolves({ Items: [pastDate, pastDay, upcoming] });
    ddb.on(QueryCommand, { TableName: 'current', KeyConditionExpression: futureKey }).resolves({ Items: [] });
    ddb.on(QueryCommand, { TableName: 'legacy', KeyConditionExpression: futureKey }).resolves({ Items: [] });
    ddb.on(UpdateCommand).resolves({ Attributes: { ...upcoming, userId: 'user-1' } });

    try {
        const result = await linkGuestBookings('user-1', 'customer@example.com');
        expect(result.bookings.map((booking) => booking.bookingId)).toEqual(['bk_3']);
        expect(ddb.commandCalls(UpdateCommand)).toHaveLength(1);
        const email = ses.commandCalls(SendEmailCommand)[0].args[0].input.Content?.Simple?.Body?.Text?.Data;
        expect(email).toContain('FUTURE-REF');
        expect(email).not.toContain('PAST-DATE');
        expect(email).not.toContain('PAST-DAY');
        expect(ddb.commandCalls(QueryCommand, { TableName: 'current', KeyConditionExpression: todayKey })[0].args[0].input)
            .toEqual(expect.objectContaining({
                FilterExpression: expect.stringContaining('#time >= :cutoffTime'),
                ExpressionAttributeValues: expect.objectContaining({
                    ':cutoffDate': '2030-01-01',
                    ':cutoffTime': '12:16',
                }),
            }));
    } finally {
        jest.useRealTimers();
    }
});

test('queries future and today separately and paginates each date range', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2030-01-01T12:15:30.000Z'));
    const future = { ...guest, bookingId: 'future', seatId: 'BOOKING#future', bookingRef: 'FUTURE', date: '2030-01-02', time: '09:00' };
    const today = { ...guest, bookingId: 'today', seatId: 'BOOKING#today', bookingRef: 'TODAY', time: '12:16' };
    const laterToday = { ...guest, bookingId: 'later', seatId: 'BOOKING#later', bookingRef: 'LATER', time: '13:00' };
    const futurePageKey = { showtimeId: 'show1', seatId: future.seatId, customerEmail: 'customer@example.com', date: future.date };
    const todayPageKey = { showtimeId: 'show1', seatId: today.seatId, customerEmail: 'customer@example.com', date: today.date };
    ddb.on(QueryCommand, { TableName: 'current', KeyConditionExpression: futureKey })
        .resolvesOnce({ Items: [], LastEvaluatedKey: futurePageKey })
        .resolvesOnce({ Items: [future] });
    ddb.on(QueryCommand, { TableName: 'current', KeyConditionExpression: todayKey })
        .resolvesOnce({ Items: [today], LastEvaluatedKey: todayPageKey })
        .resolvesOnce({ Items: [laterToday] });
    ddb.on(QueryCommand, { TableName: 'legacy', KeyConditionExpression: futureKey }).resolves({ Items: [] });
    ddb.on(UpdateCommand)
        .resolvesOnce({ Attributes: { ...future, userId: 'user-1' } })
        .resolvesOnce({ Attributes: { ...today, userId: 'user-1' } })
        .resolvesOnce({ Attributes: { ...laterToday, userId: 'user-1' } });

    try {
        const result = await linkGuestBookings('user-1', 'customer@example.com');
        expect(result.bookings.map((item) => item.bookingRef)).toEqual(['FUTURE', 'TODAY', 'LATER']);
        const futureCalls = ddb.commandCalls(QueryCommand, { TableName: 'current', KeyConditionExpression: futureKey });
        const todayCalls = ddb.commandCalls(QueryCommand, { TableName: 'current', KeyConditionExpression: todayKey });
        expect(futureCalls[1].args[0].input.ExclusiveStartKey).toEqual(futurePageKey);
        expect(todayCalls[0].args[0].input.ExclusiveStartKey).toBeUndefined();
        expect(todayCalls[1].args[0].input.ExclusiveStartKey).toEqual(todayPageKey);
        expect(futureCalls[0].args[0].input.FilterExpression).not.toContain('#time');
        expect(futureCalls[0].args[0].input.ExpressionAttributeValues).not.toHaveProperty(':cutoffTime');
        expect(todayCalls[0].args[0].input.FilterExpression).toContain('#time >= :cutoffTime');
        expect(todayCalls[0].args[0].input.ExpressionAttributeValues?.[':cutoffTime']).toBe('12:16');
    } finally {
        jest.useRealTimers();
    }
});

test('a concurrent claim is skipped and does not send an email', async () => {
    ddb.on(QueryCommand, { TableName: 'current', KeyConditionExpression: futureKey }).resolves({ Items: [guest] });
    ddb.on(QueryCommand, { TableName: 'legacy', KeyConditionExpression: futureKey }).resolves({ Items: [] });
    ddb.on(UpdateCommand).rejects(Object.assign(new Error('race'), { name: 'ConditionalCheckFailedException' }));
    expect(await linkGuestBookings('user-1', 'customer@example.com')).toEqual({ bookings: [], notificationSent: true });
    expect(ses.commandCalls(SendEmailCommand)).toHaveLength(0);
});

test('also claims bookings from the legacy table', async () => {
    const { showtimeId: _showtimeId, ...details } = guest;
    const legacy = { ...details, showingId: 'legacy-showing' };
    ddb.on(QueryCommand, { TableName: 'current', KeyConditionExpression: futureKey }).resolves({ Items: [] });
    ddb.on(QueryCommand, { TableName: 'legacy', KeyConditionExpression: futureKey }).resolves({ Items: [legacy] });
    ddb.on(UpdateCommand).resolves({ Attributes: { ...legacy, userId: 'user-1' } });
    const result = await linkGuestBookings('user-1', 'customer@example.com');
    expect(result.bookings.map((item) => item.bookingRef)).toEqual(['BBT-123456']);
    expect(ddb.commandCalls(UpdateCommand)[0].args[0].input.Key).toEqual({
        showingId: 'legacy-showing', seatId: 'BOOKING#bk_1',
    });
});

test('a later sweep does not re-link an already claimed booking even with a stale email index', async () => {
    ddb.on(QueryCommand, { TableName: 'current', KeyConditionExpression: futureKey }).resolves({ Items: [guest] });
    ddb.on(QueryCommand, { TableName: 'legacy', KeyConditionExpression: futureKey }).resolves({ Items: [] });
    ddb.on(UpdateCommand)
        .resolvesOnce({ Attributes: { ...guest, userId: 'user-1' } })
        .rejects(Object.assign(new Error('already claimed'), { name: 'ConditionalCheckFailedException' }));
    expect((await linkGuestBookings('user-1', 'customer@example.com')).bookings).toHaveLength(1);
    expect((await linkGuestBookings('user-1', 'customer@example.com')).bookings).toHaveLength(0);
    expect(ses.commandCalls(SendEmailCommand)).toHaveLength(1);
});

test('email failure is reported after successful claims', async () => {
    ddb.on(QueryCommand, { TableName: 'current', KeyConditionExpression: futureKey }).resolves({ Items: [guest] });
    ddb.on(QueryCommand, { TableName: 'legacy', KeyConditionExpression: futureKey }).resolves({ Items: [] });
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
    expect(ssm.calls()).toHaveLength(0);
});

test('history returns newly claimed records immediately even before the user index catches up', async () => {
    ssm.on(GetParameterCommand, { Name: parameterName }).resolves({ Parameter: { Value: 'true' } });
    ddb.on(QueryCommand, { IndexName: 'CustomerEmailUpcomingBookings', TableName: 'current', KeyConditionExpression: futureKey }).resolves({ Items: [guest] });
    ddb.on(QueryCommand, { IndexName: 'CustomerEmailUpcomingBookings', TableName: 'legacy', KeyConditionExpression: futureKey }).resolves({ Items: [] });
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
    expect(ddb.commandCalls(QueryCommand, { IndexName: 'CustomerEmailUpcomingBookings' })[0].args[0].input.ExpressionAttributeValues?.[':email']).toBe('customer@example.com');
});

test('history reports an SES failure without losing the claimed booking', async () => {
    ssm.on(GetParameterCommand, { Name: parameterName }).resolves({ Parameter: { Value: 'true' } });
    ddb.on(QueryCommand, { IndexName: 'CustomerEmailUpcomingBookings', TableName: 'current', KeyConditionExpression: futureKey }).resolves({ Items: [guest] });
    ddb.on(QueryCommand, { IndexName: 'CustomerEmailUpcomingBookings', TableName: 'legacy', KeyConditionExpression: futureKey }).resolves({ Items: [] });
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

test.each(['false', 'missing', 'unconfigured'])(
    'returns existing history without linking when the flag is %s',
    async (setting) => {
        if (setting === 'missing') {
            ssm.on(GetParameterCommand).rejects(Object.assign(new Error('missing'), { name: 'ParameterNotFound' }));
        } else if (setting === 'unconfigured') {
            delete process.env.ALLOW_LINK_BOOKINGS_PARAMETER_NAME;
        }
        ddb.on(QueryCommand, { IndexName: 'UserBookings' }).resolves({ Items: [] });
        ddb.on(QueryCommand, {
            TableName: 'current',
            FilterExpression: 'recordType = :booking',
        }).resolves({ Items: [guest] });
        const result = await handler({
            routeKey: 'GET /api/v1/bookings/account/history',
            requestContext: { requestId: 'test', authorizer: { jwt: { claims: {
                sub: 'user-1', token_use: 'id', email: 'customer@example.com', email_verified: true,
            } } } },
        } as OptionalJwtEvent);

        if (typeof result === 'string') throw new Error('Expected structured result.');
        expect(result.statusCode).toBe(200);
        expect(JSON.parse(result.body ?? '{}')).toMatchObject({
            newlyLinkedBookings: [],
            bookings: [expect.objectContaining({ bookingId: 'bk_1' })],
        });
        expect(ddb.commandCalls(QueryCommand, { IndexName: 'CustomerEmailUpcomingBookings' })).toHaveLength(0);
        expect(ddb.commandCalls(UpdateCommand)).toHaveLength(0);
        expect(ses.commandCalls(SendEmailCommand)).toHaveLength(0);
        expect(ssm.calls()).toHaveLength(setting === 'unconfigured' ? 0 : 1);
    }
);

test('reads the flag again on the next eligible history request', async () => {
    ssm.on(GetParameterCommand)
        .resolvesOnce({ Parameter: { Value: 'false' } })
        .resolvesOnce({ Parameter: { Value: 'true' } });
    ddb.on(QueryCommand, { IndexName: 'UserBookings' }).resolves({ Items: [] });
    ddb.on(QueryCommand, { TableName: 'current', KeyConditionExpression: futureKey }).resolves({ Items: [guest] });
    ddb.on(QueryCommand, { TableName: 'legacy', KeyConditionExpression: futureKey }).resolves({ Items: [] });
    ddb.on(UpdateCommand).resolves({ Attributes: { ...guest, userId: 'user-1' } });
    const event = {
        routeKey: 'GET /api/v1/bookings/account/history',
        requestContext: { requestId: 'test', authorizer: { jwt: { claims: {
            sub: 'user-1', token_use: 'id', email: 'customer@example.com', email_verified: true,
        } } } },
    } as OptionalJwtEvent;

    const disabled = await handler(event);
    const enabled = await handler(event);
    if (typeof disabled === 'string' || typeof enabled === 'string') throw new Error('Expected structured result.');
    expect(JSON.parse(disabled.body ?? '{}').newlyLinkedBookings).toEqual([]);
    expect(JSON.parse(enabled.body ?? '{}').newlyLinkedBookings).toEqual(['BBT-123456']);
    expect(ssm.calls()).toHaveLength(2);
    expect(ddb.commandCalls(UpdateCommand)).toHaveLength(1);
});

test.each(['invalid', 'unavailable'])(
    'reports %s parameter failures rather than silently disabling linking',
    async (failure) => {
        if (failure === 'invalid') {
            ssm.on(GetParameterCommand).resolves({ Parameter: { Value: 'yes' } });
        } else {
            ssm.on(GetParameterCommand).rejects(new Error('SSM unavailable'));
        }
        const result = await handler({
            routeKey: 'GET /api/v1/bookings/account/history',
            requestContext: { requestId: 'test', authorizer: { jwt: { claims: {
                sub: 'user-1', token_use: 'id', email: 'customer@example.com', email_verified: true,
            } } } },
        } as OptionalJwtEvent);

        if (typeof result === 'string') throw new Error('Expected structured result.');
        expect(result.statusCode).toBe(500);
        expect(ddb.commandCalls(UpdateCommand)).toHaveLength(0);
    }
);
