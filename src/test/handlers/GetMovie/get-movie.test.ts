import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
    DynamoDBDocumentClient,
    QueryCommand,
    ScanCommand,
    TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { generateShowtimes } from '../../../main/lambda/handlers/utils/showtime-schedule';

process.env.TABLE_NAME = 'test-movies-table';
process.env.SHOWTIME_REGISTRY_TABLE_NAME = 'test-showtime-registry';

const ddbMock = mockClient(DynamoDBDocumentClient);
const registry = new Map<string, Record<string, unknown>>();
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const { handler } = require('../../../main/lambda/handlers/GetMovie/get-movie-handler') as {
    handler: (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;
};

const movieRecord = {
    tmdbId: '12345',
    slug: 'example-movie',
    title: 'Example Movie',
    visible: true,
    isComingSoon: true,
    genres: ['Adventure', 'Drama'],
    mainGenre: 'Adventure',
    rating: 'PG',
    score: 7.4,
    runtime: 110,
    releaseDate: '2026-09-25T00:00:00.000Z',
    poster: 'https://example.com/poster.jpg',
    still: 'https://example.com/still.jpg',
    starring: ['Actor One', 'Actor Two'],
    director: 'Director Name',
    synopsis: 'A short description of the movie.',
    trailer: 'https://www.youtube-nocookie.com/embed/example',
};

function upcomingDate(day: string): string {
    const value = new Date();
    value.setUTCDate(value.getUTCDate() + 8);
    while (DAYS[value.getUTCDay()] !== day) value.setUTCDate(value.getUTCDate() + 1);
    return value.toISOString().slice(0, 10);
}

function seedShowtime(movieId: string, date: string, screen: string, time: string): string {
    const showtimeId = `123456_${date}_${time.replace(':', '')}`;
    registry.set(`SHOWTIME#${showtimeId}`, {
        registryKey: `SHOWTIME#${showtimeId}`,
        recordType: 'SHOWTIME',
        showtimeId,
        movieId,
        date,
        day: DAYS[new Date(`${date}T00:00:00.000Z`).getUTCDay()],
        screen,
        time,
        GSI1PK: `DATE#${date}`,
        GSI1SK: `${screen}#${time}#${movieId}#${showtimeId}`,
        source: 'GENERATED',
        status: 'ACTIVE',
    });
    return showtimeId;
}

function createEvent(id?: string, date?: string): APIGatewayProxyEventV2 {
    return {
        pathParameters: id ? { id } : undefined,
        queryStringParameters: date ? { date } : undefined,
        requestContext: { requestId: 'get-movie-test-request' },
    } as unknown as APIGatewayProxyEventV2;
}

function responseBody(result: APIGatewayProxyResultV2): Record<string, unknown> {
    if (typeof result === 'string') {
        throw new Error('Expected a structured API Gateway response.');
    }
    return JSON.parse(result.body as string) as Record<string, unknown>;
}

describe('Get movie Lambda handler', () => {
    beforeEach(() => {
        ddbMock.reset();
        registry.clear();
        delete process.env.BOOKINGS_TABLE_NAME;
        ddbMock.on(QueryCommand).callsFake((input) => {
            if (input.IndexName === 'ShowtimesByDate') {
                return {
                    Items: [...registry.values()].filter(
                        (item) => item.GSI1PK === input.ExpressionAttributeValues?.[':dateKey']
                    ),
                };
            }
            return { Items: [movieRecord] };
        });
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('returns the detail projection for a movie ID', async () => {
        const [day, daySchedule] = Object.entries(
            generateShowtimes(movieRecord.tmdbId, movieRecord.releaseDate, movieRecord.score)
        )[0];
        const date = upcomingDate(day);
        const expectedShowtimes = daySchedule.map(({ screen, time }) => ({
            screen,
            time,
            date,
            showtimeId: seedShowtime(movieRecord.tmdbId, date, screen, time),
        }));
        const result = await handler(createEvent('12345', date));

        expect(result).toMatchObject({ statusCode: 200 });
        expect(responseBody(result)).toMatchObject({
            slug: 'example-movie',
            sortTitle: 'Example Movie',
            movieId: 12345,
            title: 'Example Movie',
            visible: true,
            preSalesEligible: false,
            genres: ['Adventure', 'Drama'],
            mainGenre: 'Adventure',
            rating: 'PG',
            score: 7.4,
            runtime: 110,
            releaseDate: '2026-09-25T00:00:00.000Z',
            poster: 'https://example.com/poster.jpg',
            still: 'https://example.com/still.jpg',
            starring: ['Actor One', 'Actor Two'],
            director: 'Director Name',
            synopsis: 'A short description of the movie.',
            trailer: 'https://www.youtube-nocookie.com/embed/example',
        });
        expect(responseBody(result).showtimes).toEqual({ [day]: expectedShowtimes });
        expect(ddbMock.commandCalls(QueryCommand)[0].args[0].input).toMatchObject({
            TableName: 'test-movies-table',
            KeyConditionExpression: 'tmdbId = :tmdbId',
            ExpressionAttributeValues: { ':tmdbId': '12345' },
            ConsistentRead: true,
        });
        expect(ddbMock.commandCalls(ScanCommand)).toHaveLength(0);
        expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
    });

    it('returns date-specific stable showtime IDs with assigned screens', async () => {
        const [day, daySchedule] = Object.entries(
            generateShowtimes(movieRecord.tmdbId, movieRecord.releaseDate, movieRecord.score)
        )[0];
        const date = upcomingDate(day);
        const expectedShowtimes = daySchedule.map(({ screen, time }) => ({
            screen,
            time,
            date,
            showtimeId: seedShowtime(movieRecord.tmdbId, date, screen, time),
        }));

        const result = await handler(createEvent('12345', date));

        expect(result).toMatchObject({ statusCode: 200 });
        const response = responseBody(result);
        const showtimesResult = response.showtimes as Record<string, Array<Record<string, unknown>>>;
        expect(showtimesResult[day]).toEqual(expectedShowtimes);
        const id = showtimesResult[day][0].showtimeId;
        const secondResult = await handler(createEvent('12345', date));
        expect(secondResult).toMatchObject({ statusCode: 200 });
        const secondSchedule = responseBody(secondResult).showtimes as Record<
            string,
            Array<Record<string, unknown>>
        >;
        expect(secondSchedule[day][0].showtimeId).toBe(id);
    });

    it('returns a stable date-specific showtime ID for Bohemian Rhapsody Sunday 12:15 screen 5', async () => {
        const movie = {
            ...movieRecord,
            tmdbId: '424694',
            title: 'Bohemian Rhapsody',
        };
        const [day, expected] = Object.entries(
            generateShowtimes(movie.tmdbId, movie.releaseDate, movie.score)
        )[0];
        const date = upcomingDate(day);
        const showtimeId = seedShowtime(
            movie.tmdbId,
            date,
            expected[0].screen,
            expected[0].time
        );
        ddbMock.on(QueryCommand).callsFake((input) => (
            input.IndexName === 'ShowtimesByDate'
                ? {
                    Items: [...registry.values()].filter(
                        (item) => item.GSI1PK === input.ExpressionAttributeValues?.[':dateKey']
                    ),
                }
                : { Items: [movie] }
        ));

        const result = await handler(createEvent('424694', date));

        const showtimes = responseBody(result).showtimes as Record<
            string,
            Array<Record<string, unknown>>
        >;
        expect(showtimes[day][0]).toMatchObject({
            screen: expected[0].screen,
            time: expected[0].time,
            date,
            showtimeId,
        });
    });

    it('returns 404 when the movie does not exist', async () => {
        ddbMock.on(QueryCommand).resolves({ Items: [] });

        const result = await handler(createEvent('12345'));

        expect(result).toMatchObject({ statusCode: 404 });
        expect(responseBody(result)).toEqual({ message: 'Movie not found.' });
    });

    it('returns 409 if an ID unexpectedly has multiple slug keys', async () => {
        ddbMock.on(QueryCommand).resolves({
            Items: [movieRecord, { ...movieRecord, slug: 'another-slug' }],
        });

        const result = await handler(createEvent('12345'));

        expect(result).toMatchObject({ statusCode: 409 });
        expect(responseBody(result)).toEqual({
            message: 'Multiple movie records match this ID.',
        });
    });

    it('rejects non-numeric IDs', async () => {
        const result = await handler(createEvent('example-movie'));

        expect(result).toMatchObject({ statusCode: 400 });
        expect(responseBody(result)).toEqual({
            message: 'A numeric movie ID is required.',
        });
        expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
    });

    it('rejects missing IDs without querying DynamoDB', async () => {
        const result = await handler(createEvent());

        expect(result).toMatchObject({ statusCode: 400 });
        expect(responseBody(result)).toEqual({
            message: 'A numeric movie ID is required.',
        });
        expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
    });

    it('handles requests without request context and query results without Items', async () => {
        ddbMock.on(QueryCommand).resolves({});

        const result = await handler({
            pathParameters: { id: '12345' },
        } as APIGatewayProxyEventV2);

        expect(result).toMatchObject({ statusCode: 404 });
        expect(responseBody(result)).toEqual({ message: 'Movie not found.' });
    });

    it('returns an internal error for an invalid stored movie record', async () => {
        ddbMock.on(QueryCommand).resolves({
            Items: [{ ...movieRecord, title: 42 }],
        });

        const result = await handler(createEvent('12345'));

        expect(result).toMatchObject({ statusCode: 500 });
        expect(responseBody(result)).toEqual({
            message: 'Unable to retrieve movie.',
        });
    });

    it.each([
        ['an Error', new Error('DynamoDB unavailable')],
        ['a non-Error value', 'DynamoDB unavailable'],
    ])('handles query failures represented by %s', async (_name, error) => {
        ddbMock.on(QueryCommand).rejects(error);

        const result = await handler(createEvent('12345'));

        expect(result).toMatchObject({ statusCode: 500 });
        expect(responseBody(result)).toEqual({
            message: 'Unable to retrieve movie.',
        });
    });
});
