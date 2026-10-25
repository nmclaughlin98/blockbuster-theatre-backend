import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';

process.env.TABLE_NAME = 'test-movies-table';

const ddbMock = mockClient(DynamoDBDocumentClient);
const { handler } = require('../../main/lambda/handlers/get-movie-handler') as {
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
    showtimes: {
        Monday: [
            { screen: '1', time: '11:00', showtimeId: 'show_12345_monday_1_1100' },
            { screen: '3', time: '19:00', showtimeId: 'show_12345_monday_3_1900' },
        ],
        Tuesday: [
            { screen: '2', time: '13:00', showtimeId: 'show_12345_tuesday_2_1300' },
            { screen: '5', time: '20:00', showtimeId: 'show_12345_tuesday_5_2000' },
        ],
    },
};

function createEvent(id?: string): APIGatewayProxyEventV2 {
    return {
        pathParameters: id ? { id } : undefined,
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
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('returns the detail projection for a movie ID', async () => {
        ddbMock.on(QueryCommand).resolves({ Items: [movieRecord] });

        const result = await handler(createEvent('12345'));

        expect(result).toMatchObject({ statusCode: 200 });
        expect(responseBody(result)).toEqual({
            slug: 'example-movie',
            sortTitle: 'Example Movie',
            movieId: 12345,
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
            showtimes: {
                Monday: [
                    { screen: '1', time: '11:00', showtimeId: 'show_12345_monday_1_1100' },
                    { screen: '3', time: '19:00', showtimeId: 'show_12345_monday_3_1900' },
                ],
                Tuesday: [
                    { screen: '2', time: '13:00', showtimeId: 'show_12345_tuesday_2_1300' },
                    { screen: '5', time: '20:00', showtimeId: 'show_12345_tuesday_5_2000' },
                ],
            },
        });
        expect(ddbMock.commandCalls(QueryCommand)[0].args[0].input).toMatchObject({
            TableName: 'test-movies-table',
            KeyConditionExpression: 'tmdbId = :tmdbId',
            ExpressionAttributeValues: { ':tmdbId': '12345' },
            ConsistentRead: true,
        });
    });

    it('returns showtimes with assigned screens', async () => {
        const showtimes = {
            Monday: [
                { screen: '1', time: '13:00' },
                { screen: '3', time: '14:20' },
            ],
        };
        ddbMock.on(QueryCommand).resolves({
            Items: [{ ...movieRecord, showtimes }],
        });

        const result = await handler(createEvent('12345'));

        expect(result).toMatchObject({ statusCode: 200 });
        expect(responseBody(result).showtimes).toEqual({
            Monday: [
                { screen: '1', time: '13:00', showtimeId: 'show_12345_monday_1_1300' },
                { screen: '3', time: '14:20', showtimeId: 'show_12345_monday_3_1420' },
            ],
        });
    });

    it('returns a stable showtime ID for the Bohemian Rhapsody Sunday 12:15 screen 5 slot', async () => {
        ddbMock.on(QueryCommand).resolves({
            Items: [
                {
                    ...movieRecord,
                    tmdbId: '424694',
                    title: 'Bohemian Rhapsody',
                    showtimes: { Sunday: [{ screen: '5', time: '12:15' }] },
                },
            ],
        });

        const result = await handler(createEvent('424694'));

        expect(responseBody(result).showtimes).toEqual({
            Sunday: [
                {
                    screen: '5',
                    time: '12:15',
                    showtimeId: 'show_424694_sunday_5_1215',
                },
            ],
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
