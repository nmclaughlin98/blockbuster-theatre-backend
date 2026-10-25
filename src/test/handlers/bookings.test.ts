import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
    DynamoDBDocumentClient,
    GetCommand,
    QueryCommand,
    TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';

process.env.TABLE_NAME = 'test-movies-table';
process.env.OFFERS_TABLE_NAME = 'test-offers-table';
process.env.PRICING_TABLE_NAME = 'test-pricing-table';
process.env.BOOKINGS_TABLE_NAME = 'test-bookings-table';
process.env.LEGACY_BOOKINGS_TABLE_NAME = 'test-legacy-bookings-table';
process.env.SHOWTIME_REGISTRY_TABLE_NAME = 'test-showtime-registry';

const ddbMock = mockClient(DynamoDBDocumentClient);
type Handler = (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;
const { handler: listBookings } = require('../../main/lambda/handlers/list-bookings-handler') as {
    handler: Handler;
};
const { handler: createBooking } = require('../../main/lambda/handlers/create-booking-handler') as {
    handler: Handler;
};

const movie = {
    tmdbId: '456',
    slug: 'a-movie',
    title: 'A Movie',
    visible: true,
    isComingSoon: false,
    genres: ['Adventure'],
    mainGenre: 'Adventure',
    rating: 'PG',
    score: 7.4,
    runtime: 110,
    releaseDate: '2026-09-25T00:00:00.000Z',
    poster: 'https://example.com/poster.jpg',
    still: 'https://example.com/still.jpg',
    starring: ['Actor One'],
    director: 'Director Name',
    synopsis: 'A short description.',
    tagline: 'A tagline.',
    trailer: 'https://example.com/trailer',
    showtimes: { Monday: [{ screen: '3', time: '19:00' }] },
    GSI1PK: 'MOVIE',
    GSI1SK: '2026-09-25#456',
};

const standardPricing = {
    pricingId: 'STANDARD_RATES',
    name: 'Standard Rates',
    currency: 'GBP',
    ticketTiers: [{ id: 'adult', label: 'Adult', description: 'Adult admission', price: 9 }],
};

const mondayOffer = {
    offerId: 'monday-offer',
    title: 'Monday Offer',
    tagline: 'Every Monday',
    priceDescription: 'Tickets from £5',
    ctaLabel: 'Book tickets',
    featuredMovieId: '456',
    pricingId: 'STANDARD_RATES',
    isActive: true,
};

const showtime = { day: 'Monday', time: '19:00' };

/** A Monday at least a week ahead, so the "not in the past" check never depends on today. */
function upcomingMonday(): string {
    const value = new Date();
    value.setUTCDate(value.getUTCDate() + 7);
    while (value.getUTCDay() !== 1) value.setUTCDate(value.getUTCDate() + 1);
    return value.toISOString().slice(0, 10);
}

const date = upcomingMonday();
const showtimeId = `559924_${date}_1900`;

function pastMonday(): string {
    const value = new Date();
    value.setUTCDate(value.getUTCDate() - 7);
    while (value.getUTCDay() !== 1) value.setUTCDate(value.getUTCDate() - 1);
    return value.toISOString().slice(0, 10);
}

function createEvent(options: {
    queryStringParameters?: Record<string, string>;
    body?: unknown;
    rawBody?: string;
} = {}): APIGatewayProxyEventV2 {
    return {
        queryStringParameters: options.queryStringParameters,
        body:
            options.rawBody ??
            (options.body === undefined ? undefined : JSON.stringify(options.body)),
        requestContext: { requestId: 'booking-test-request' },
    } as unknown as APIGatewayProxyEventV2;
}

function responseBody(result: APIGatewayProxyResultV2): Record<string, unknown> {
    if (typeof result === 'string') throw new Error('Expected a structured response.');
    return JSON.parse(result.body as string) as Record<string, unknown>;
}

function mockShowingLookups(): void {
    ddbMock.on(QueryCommand, { TableName: 'test-movies-table' }).resolves({ Items: [movie] });
    ddbMock.on(GetCommand, { TableName: 'test-offers-table' }).resolves({ Item: mondayOffer });
    ddbMock.on(GetCommand, { TableName: 'test-pricing-table' }).resolves({ Item: standardPricing });
    ddbMock
        .on(GetCommand, { TableName: 'test-showtime-registry' })
        .callsFake((input) => {
            const registryKey = input.Key?.registryKey;
            if (typeof registryKey !== 'string') return {};
            const match = /^SCHEDULE#456#(\d{4}-\d{2}-\d{2})#3#19:00$/.exec(registryKey);
            if (!match) return {};
            const id = `559924_${match[1]}_1900`;
            return {
                Item: {
                    registryKey,
                    recordType: 'SCHEDULE',
                    showtimeId: id,
                },
            };
        });
}

const query = { movieId: '456', date, day: 'Monday', time: '19:00' };

describe('booking handlers', () => {
    beforeEach(() => {
        ddbMock.reset();
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('GET /bookings', () => {
        it('returns the booked seats for a showing on a date, paging through results', async () => {
            mockShowingLookups();
            ddbMock
                .on(QueryCommand, { TableName: 'test-bookings-table' })
                .resolvesOnce({
                    Items: [{ seatId: 'C2' }, { seatId: 'B4' }],
                    LastEvaluatedKey: { showtimeId, seatId: 'C2' },
                })
                .resolvesOnce({ Items: [{ seatId: 'A1' }] });
            ddbMock.on(QueryCommand, { TableName: 'test-legacy-bookings-table' }).resolves({
                Items: [],
            });

            const result = await listBookings(createEvent({ queryStringParameters: query }));

            expect(result).toMatchObject({ statusCode: 200 });
            expect(responseBody(result)).toEqual({
                movieId: '456',
                date,
                showtime: { ...showtime, screen: '3' },
                bookedSeats: ['A1', 'B4', 'C2'],
            });
            const calls = ddbMock.commandCalls(QueryCommand).filter(
                (call) => call.args[0].input.TableName === 'test-bookings-table'
            );
            expect(calls).toHaveLength(2);
            expect(calls[0].args[0].input.ExpressionAttributeValues).toEqual({
                ':key': showtimeId,
                ':seat': 'SEAT',
            });
        });

        it('keeps different dates for the same weekday separate', async () => {
            ddbMock.on(QueryCommand).resolves({ Items: [] });
            mockShowingLookups();
            const nextWeek = new Date(`${date}T00:00:00Z`);
            nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);

            await listBookings(
                createEvent({
                    queryStringParameters: { ...query, date: nextWeek.toISOString().slice(0, 10) },
                })
            );

            expect(
                ddbMock.commandCalls(QueryCommand).find(
                    (call) => call.args[0].input.TableName === 'test-bookings-table'
                )?.args[0].input.ExpressionAttributeValues
            ).toMatchObject({
                ':key': `559924_${nextWeek.toISOString().slice(0, 10)}_1900`,
                ':seat': 'SEAT',
            });
        });

        it('returns an empty list when nothing is booked', async () => {
            ddbMock.on(QueryCommand).resolves({ Items: [] });
            mockShowingLookups();

            const result = await listBookings(createEvent({ queryStringParameters: query }));

            expect(responseBody(result).bookedSeats).toEqual([]);
        });

        it.each([
            ['no parameters', undefined],
            ['a missing movieId', { ...query, movieId: undefined }],
            ['a non-numeric movieId', { ...query, movieId: 'abc' }],
            ['a missing date', { ...query, date: undefined }],
            ['a date in the wrong format', { ...query, date: '01/02/2027' }],
            ['an impossible calendar date', { ...query, date: '2027-02-30' }],
            ['a date that is not on the given weekday', { ...query, day: 'Tuesday' }],
            ['an unknown day', { ...query, day: 'Someday' }],
            ['a malformed time', { ...query, time: '7pm' }],
        ])('rejects %s', async (_name, queryStringParameters) => {
            const result = await listBookings(
                createEvent({
                    queryStringParameters: queryStringParameters as Record<string, string>,
                })
            );

            expect(result).toMatchObject({ statusCode: 400 });
            expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
        });

        it('returns a generic 500 when the lookup fails', async () => {
            ddbMock.on(QueryCommand).rejects(new Error('boom'));

            const result = await listBookings(createEvent({ queryStringParameters: query }));

            expect(result).toMatchObject({ statusCode: 500 });
            expect(responseBody(result)).toEqual({ message: 'Unable to list bookings.' });
        });
    });

    describe('POST /bookings', () => {
        it('stores each seat against one generated booking and user ID', async () => {
            mockShowingLookups();
            ddbMock.on(TransactWriteCommand).resolves({});

            const result = await createBooking(
                createEvent({
                    body: { movieId: '456', date, showtime, seats: ['b4', 'B5'] },
                })
            );

            expect(result).toMatchObject({ statusCode: 201 });
            const body = responseBody(result);
            expect(body).toMatchObject({
                movieId: '456',
                movieTitle: 'A Movie',
                date,
                showtime: { ...showtime, screen: '3' },
                showtimeId,
                seats: ['B4', 'B5'],
            });
            expect(body.bookingId).toEqual(expect.any(String));
            expect(body.userId).toEqual(expect.any(String));

            const items = ddbMock.commandCalls(TransactWriteCommand)[0].args[0].input
                .TransactItems!;
            expect(items).toHaveLength(4);
            expect(items.map((item) => item.Put?.Item)).toEqual([
                expect.objectContaining({
                    showtimeId,
                    seatId: 'B4',
                    date,
                    time: '19:00',
                    bookingId: body.bookingId,
                    userId: body.userId,
                }),
                expect.objectContaining({ showtimeId, seatId: 'B5', userId: body.userId }),
            ]);
            expect(items[0].Put?.TableName).toBe('test-bookings-table');
            expect(items[0].Put?.ConditionExpression).toBe('attribute_not_exists(seatId)');
        });

        it('books through an offer when the movie matches', async () => {
            mockShowingLookups();
            ddbMock.on(TransactWriteCommand).resolves({});

            const result = await createBooking(
                createEvent({
                    body: {
                        movieId: '456',
                        offerId: 'monday-offer',
                        date,
                        showtime,
                        seats: ['A2'],
                    },
                })
            );

            expect(result).toMatchObject({ statusCode: 201 });
        });

        it('rejects an offer that belongs to a different movie', async () => {
            mockShowingLookups();

            const result = await createBooking(
                createEvent({
                    body: {
                        movieId: '111',
                        offerId: 'monday-offer',
                        date,
                        showtime,
                        seats: ['A2'],
                    },
                })
            );

            expect(result).toMatchObject({ statusCode: 400 });
            expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
        });

        it('rejects a client-supplied user ID', async () => {
            const result = await createBooking(
                createEvent({
                    body: { movieId: '456', date, showtime, seats: ['A2'], userId: 'someone-else' },
                })
            );

            expect(result).toMatchObject({ statusCode: 400 });
            expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
        });

        it('returns 409 naming the seats that are already booked', async () => {
            mockShowingLookups();
            const error = Object.assign(new Error('Transaction cancelled'), {
                name: 'TransactionCanceledException',
                CancellationReasons: [{ Code: 'None' }, { Code: 'ConditionalCheckFailed' }],
            });
            ddbMock.on(TransactWriteCommand).rejects(error);

            const result = await createBooking(
                createEvent({ body: { movieId: '456', date, showtime, seats: ['B4', 'B5'] } })
            );

            expect(result).toMatchObject({ statusCode: 409 });
            expect(responseBody(result)).toEqual({ message: 'Seat already booked: B5.' });
        });

        it('rejects showtimes that are not scheduled for the movie', async () => {
            mockShowingLookups();

            const result = await createBooking(
                createEvent({
                    body: {
                        movieId: '456',
                        date,
                        showtime: { day: 'Monday', time: '21:00' },
                        seats: ['B4'],
                    },
                })
            );

            expect(result).toMatchObject({ statusCode: 400 });
            expect(responseBody(result)).toEqual({
                message: 'The selected showtime is not available.',
            });
            expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
        });

        it('rejects a date in the past', async () => {
            mockShowingLookups();

            const result = await createBooking(
                createEvent({
                    body: { movieId: '456', date: pastMonday(), showtime, seats: ['B4'] },
                })
            );

            expect(result).toMatchObject({ statusCode: 400 });
            expect(responseBody(result)).toEqual({ message: 'date must not be in the past.' });
            expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
        });

        it('returns 404 for an unknown movie', async () => {
            ddbMock.on(QueryCommand, { TableName: 'test-movies-table' }).resolves({ Items: [] });

            const result = await createBooking(
                createEvent({ body: { movieId: '999', date, showtime, seats: ['B4'] } })
            );

            expect(result).toMatchObject({ statusCode: 404 });
        });

        it.each([
            ['no seats', { movieId: '456', date, showtime, seats: [] }],
            ['missing seats', { movieId: '456', date, showtime }],
            ['a non-array seats value', { movieId: '456', date, showtime, seats: 'B4' }],
            ['an out-of-range row', { movieId: '456', date, showtime, seats: ['H1'] }],
            ['an out-of-range seat number', { movieId: '456', date, showtime, seats: ['A12'] }],
            ['a repeated seat', { movieId: '456', date, showtime, seats: ['B4', 'b4'] }],
            [
                'too many seats',
                {
                    movieId: '456',
                    date,
                    showtime,
                    seats: ['A1', 'A2', 'A3', 'A4', 'A5', 'B1', 'B2', 'B3', 'B4', 'B5', 'C1'],
                },
            ],
            ['an invalid movie ID', { movieId: 'x', date, showtime, seats: ['B4'] }],
            ['a missing date', { movieId: '456', showtime, seats: ['B4'] }],
            ['a malformed date', { movieId: '456', date: '25-10-2026', showtime, seats: ['B4'] }],
            ['an impossible date', { movieId: '456', date: '2027-02-30', showtime, seats: ['B4'] }],
            [
                'a date on a different weekday to showtime.day',
                { movieId: '456', date, showtime: { day: 'Tuesday', time: '19:00' }, seats: ['B4'] },
            ],
            ['a missing showtime', { movieId: '456', date, seats: ['B4'] }],
            [
                'an unknown showtime key',
                { movieId: '456', date, showtime: { ...showtime, venue: '1' }, seats: ['B4'] },
            ],
        ])('rejects %s', async (_name, body) => {
            const result = await createBooking(createEvent({ body }));

            expect(result).toMatchObject({ statusCode: 400 });
            expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
        });

        it('rejects a missing or malformed body', async () => {
            expect(await createBooking(createEvent())).toMatchObject({ statusCode: 400 });
            expect(await createBooking(createEvent({ rawBody: '{nope' }))).toMatchObject({
                statusCode: 400,
            });
        });

        it('returns a generic 500 when the write fails unexpectedly', async () => {
            mockShowingLookups();
            ddbMock.on(TransactWriteCommand).rejects(new Error('boom'));

            const result = await createBooking(
                createEvent({ body: { movieId: '456', date, showtime, seats: ['B4'] } })
            );

            expect(result).toMatchObject({ statusCode: 500 });
            expect(responseBody(result)).toEqual({ message: 'Unable to create booking.' });
        });
    });
});
