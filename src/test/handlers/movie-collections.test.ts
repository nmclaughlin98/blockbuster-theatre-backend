import type {
    APIGatewayProxyEventV2,
    APIGatewayProxyResultV2,
} from 'aws-lambda';
import {
    DynamoDBDocumentClient,
    GetCommand,
    PutCommand,
    QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';

process.env.TABLE_NAME = 'test-movies';
process.env.COLLECTIONS_TABLE_NAME = 'test-collections';
process.env.TMDB_API_KEY = 'test-token';
process.env.TMDB_TIMEOUT_MS = '1000';
process.env.TMDB_RETRIES = '2';

const ddbMock = mockClient(DynamoDBDocumentClient);
const { handler: refreshCollection } = require(
    '../../main/lambda/handlers/refresh-movie-collection-handler'
) as {
    handler: (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;
};
const { handler: getCollection } = require(
    '../../main/lambda/handlers/get-movie-collection-handler'
) as {
    handler: (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;
};

const fetchMock: jest.MockedFunction<typeof fetch> = jest.fn();
global.fetch = fetchMock;

function createEvent(id?: string): APIGatewayProxyEventV2 {
    return {
        pathParameters: id ? { id } : undefined,
        requestContext: { requestId: 'movie-collections-test-request' },
    } as unknown as APIGatewayProxyEventV2;
}

function responseBody(result: APIGatewayProxyResultV2): Record<string, any> {
    if (typeof result === 'string') {
        throw new Error('Expected a structured API Gateway response.');
    }
    return JSON.parse(result.body as string);
}

function tmdbResponse(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function movie(tmdbId: string) {
    return {
        tmdbId,
        slug: `movie-${tmdbId}`,
        title: `Movie ${tmdbId}`,
        visible: true,
        isComingSoon: false,
        isCarousel: false,
        genres: ['Adventure'],
        mainGenre: 'Adventure',
        rating: 'PG',
        score: 8,
        runtime: 120,
        releaseDate: '2025-01-01T00:00:00.000Z',
        poster: '',
        largePoster: '',
        still: '',
        largeStill: '',
        starring: [],
        director: 'Director',
        synopsis: 'Synopsis',
        tagline: '',
        trailer: '',
        showtimes: {},
    };
}

describe('TMDB list-backed movie collections', () => {
    beforeEach(() => {
        ddbMock.reset();
        ddbMock.on(GetCommand).resolves({});
        ddbMock.on(QueryCommand).resolves({ Items: [] });
        ddbMock.on(PutCommand).resolves({});
        fetchMock.mockReset();
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('refreshes all TMDB pages and stores movie IDs even when catalogue records are absent', async () => {
        fetchMock.mockImplementation(async (input) => {
            const url = new URL(String(input));
            if (url.searchParams.get('page') === '1') {
                return tmdbResponse({
                    id: 8706524,
                    name: 'Marvel Cinematic Universe',
                    description: 'An interconnected film series.',
                    poster_path: null,
                    backdrop_path: null,
                    page: 1,
                    total_pages: 2,
                    items: [
                        { id: 1726, media_type: 'movie' },
                        { id: 1724, media_type: 'movie' },
                    ],
                });
            }
            return tmdbResponse({
                id: 8706524,
                name: 'Marvel Cinematic Universe',
                description: 'An interconnected film series.',
                poster_path: null,
                backdrop_path: null,
                page: 2,
                total_pages: 2,
                items: [
                    { id: 999, media_type: 'movie' },
                    { id: 500, media_type: 'tv' },
                ],
            });
        });

        const result = await refreshCollection(createEvent('8706524'));

        expect(result).toMatchObject({ statusCode: 200 });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(new URL(String(fetchMock.mock.calls[0][0])).toString()).toContain(
            '/3/list/8706524?language=en-US&page=1'
        );
        expect(ddbMock.commandCalls(PutCommand)[0].args[0].input).toMatchObject({
            TableName: 'test-collections',
            Item: {
                collectionId: '8706524',
                name: 'Marvel Cinematic Universe',
                description: 'An interconnected film series.',
                posterUrl: '',
                backdropUrl: '',
                movieIds: ['1726', '1724', '999'],
            },
        });
    });

    it('rejects invalid list IDs and leaves stored data untouched for missing lists', async () => {
        const invalidId = await refreshCollection(createEvent('abc'));
        expect(invalidId).toMatchObject({ statusCode: 400 });

        fetchMock.mockResolvedValue(tmdbResponse({ status_message: 'not found' }, 404));
        const missing = await refreshCollection(createEvent('404'));
        expect(missing).toMatchObject({ statusCode: 404 });
        expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
    });

    it('converts TMDB image paths to full poster and backdrop URLs', async () => {
        fetchMock.mockResolvedValue(tmdbResponse({
            id: 8706524,
            name: 'Marvel Cinematic Universe',
            description: 'Description.',
            poster_path: '/poster.jpg',
            backdrop_path: '/backdrop.jpg',
            page: 1,
            total_pages: 1,
            items: [{ id: 1726, media_type: 'movie' }],
        }));

        await refreshCollection(createEvent('8706524'));

        expect(ddbMock.commandCalls(PutCommand)[0].args[0].input.Item).toMatchObject({
            posterUrl: 'https://image.tmdb.org/t/p/w500/poster.jpg',
            backdropUrl: 'https://image.tmdb.org/t/p/w1280/backdrop.jpg',
        });
    });

    it('returns all master IDs and only enriches IDs present in the movie catalogue', async () => {
        ddbMock.on(GetCommand).resolves({
            Item: {
                collectionId: '8706524',
                name: 'Marvel Cinematic Universe',
                description: 'An interconnected film series.',
                posterUrl: '',
                backdropUrl: '',
                movieIds: ['1726', '999'],
            },
        });
        ddbMock.on(QueryCommand).callsFake((input) => (
            input.ExpressionAttributeValues?.[':tmdbId'] === '1726'
                ? { Items: [movie('1726')] }
                : { Items: [] }
        ));

        const result = await getCollection(createEvent('8706524'));

        expect(result).toMatchObject({ statusCode: 200 });
        expect(responseBody(result)).toMatchObject({
            collection: {
                collectionId: '8706524',
                description: 'An interconnected film series.',
                posterUrl: '',
                backdropUrl: '',
                movieIds: ['1726', '999'],
            },
            movies: [{ movieId: 1726, title: 'Movie 1726' }],
        });
        expect(responseBody(result).movies).toHaveLength(1);
    });
});
