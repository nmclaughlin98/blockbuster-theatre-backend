import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
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
        Monday: ['11:00', '19:00'],
        Tuesday: ['13:00', '20:00'],
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
        ddbMock.on(GetCommand).resolves({ Item: movieRecord });

        const result = await handler(createEvent('12345'));

        expect(result).toMatchObject({ statusCode: 200 });
        expect(responseBody(result)).toEqual({
            slug: 'example-movie',
            movieId: 12345,
            title: 'Example Movie',
            visible: true,
            isComingSoon: true,
            genres: ['Adventure', 'Drama'],
            genre: 'Adventure',
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
                Monday: ['11:00', '19:00'],
                Tuesday: ['13:00', '20:00'],
            },
        });
        expect(ddbMock.commandCalls(GetCommand)[0].args[0].input).toMatchObject({
            TableName: 'test-movies-table',
            Key: { tmdbId: '12345' },
        });
    });

    it('returns 404 when the movie does not exist', async () => {
        ddbMock.on(GetCommand).resolves({});

        const result = await handler(createEvent('12345'));

        expect(result).toMatchObject({ statusCode: 404 });
        expect(responseBody(result)).toEqual({ message: 'Movie not found.' });
    });

    it('rejects non-numeric IDs', async () => {
        const result = await handler(createEvent('example-movie'));

        expect(result).toMatchObject({ statusCode: 400 });
        expect(responseBody(result)).toEqual({
            message: 'A numeric movie ID is required.',
        });
        expect(ddbMock.commandCalls(GetCommand)).toHaveLength(0);
    });
});
