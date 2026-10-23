import type {
    APIGatewayProxyEventV2,
    APIGatewayProxyResultV2,
} from 'aws-lambda';
import {
    DynamoDBDocumentClient,
    GetCommand,
    QueryCommand,
    ScanCommand,
    UpdateCommand,
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
const { handler: listCollections } = require(
    '../../main/lambda/handlers/list-movie-collections-handler'
) as {
    handler: (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;
};

const fetchMock: jest.MockedFunction<typeof fetch> = jest.fn();
global.fetch = fetchMock;

function createEvent(id?: string, body?: unknown): APIGatewayProxyEventV2 {
    return {
        pathParameters: id ? { id } : undefined,
        body: body === undefined
            ? undefined
            : typeof body === 'string'
                ? body
                : JSON.stringify(body),
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
        still: '',
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
        ddbMock.on(UpdateCommand).resolves({});
        ddbMock.on(ScanCommand).resolves({ Items: [] });
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

        const result = await refreshCollection(createEvent(undefined, {
            ids: ['8706524'],
        }));

        expect(result).toMatchObject({ statusCode: 200 });
        expect(responseBody(result)).toMatchObject({
            refreshedCount: 1,
            failedCount: 0,
            results: [{
                collectionId: '8706524',
                success: true,
                name: 'Marvel Cinematic Universe',
                movieCount: 3,
            }],
        });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(new URL(String(fetchMock.mock.calls[0][0])).toString()).toContain(
            '/3/list/8706524?language=en-US&page=1'
        );
        expect(ddbMock.commandCalls(UpdateCommand)[0].args[0].input).toMatchObject({
            TableName: 'test-collections',
            Key: { collectionId: '8706524' },
            ExpressionAttributeValues: {
                ':name': 'Marvel Cinematic Universe',
                ':description': 'An interconnected film series.',
                ':posterUrl': '',
                ':backdropUrl': '',
                ':movieIds': ['1726', '1724', '999'],
                ':isActive': true,
            },
        });
        expect(ddbMock.commandCalls(UpdateCommand)[0].args[0].input.UpdateExpression)
            .toContain('#isActive = if_not_exists(#isActive, :isActive)');
    });

    it('validates the IDs array and rejects duplicates before making TMDB requests', async () => {
        const missingBody = await refreshCollection(createEvent());
        const invalidJson = await refreshCollection(createEvent(undefined, '{'));
        const emptyIds = await refreshCollection(createEvent(undefined, { ids: [] }));
        const invalidId = await refreshCollection(createEvent(undefined, {
            ids: ['abc'],
        }));
        const fractionalId = await refreshCollection(createEvent(undefined, {
            ids: [1.5],
        }));
        const unsafeId = await refreshCollection(createEvent(undefined, {
            ids: [Number.MAX_SAFE_INTEGER + 1],
        }));
        const duplicateIds = await refreshCollection(createEvent(undefined, {
            ids: ['00123', 123],
        }));
        const tooManyIds = await refreshCollection(createEvent(undefined, {
            ids: Array.from({ length: 26 }, (_, index) => String(index + 1)),
        }));

        expect(missingBody).toMatchObject({ statusCode: 400 });
        expect(invalidJson).toMatchObject({ statusCode: 400 });
        expect(emptyIds).toMatchObject({ statusCode: 400 });
        expect(invalidId).toMatchObject({ statusCode: 400 });
        expect(responseBody(invalidId)).toMatchObject({ invalidIndexes: [0] });
        expect(fractionalId).toMatchObject({ statusCode: 400 });
        expect(unsafeId).toMatchObject({ statusCode: 400 });
        expect(duplicateIds).toMatchObject({ statusCode: 400 });
        expect(responseBody(duplicateIds)).toMatchObject({ duplicateIds: ['123'] });
        expect(tooManyIds).toMatchObject({ statusCode: 400 });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
    });

    it('reports per-ID failures while refreshing other lists in the same request', async () => {
        fetchMock.mockImplementation(async (input) => {
            const url = new URL(String(input));
            if (url.pathname.endsWith('/404')) {
                return tmdbResponse({ status_message: 'not found' }, 404);
            }
            return tmdbResponse({
                id: 8706524,
                name: 'Marvel Cinematic Universe',
                description: 'An interconnected film series.',
                page: 1,
                total_pages: 1,
                items: [{ id: 1726, media_type: 'movie' }],
            });
        });

        const result = await refreshCollection(createEvent(undefined, {
            ids: ['8706524', '404'],
        }));

        expect(result).toMatchObject({ statusCode: 207 });
        expect(responseBody(result)).toMatchObject({
            refreshedCount: 1,
            failedCount: 1,
            results: [
                { collectionId: '8706524', success: true },
                {
                    collectionId: '404',
                    success: false,
                    statusCode: 404,
                    message: 'TMDB list not found.',
                },
            ],
        });
        expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(1);
    });

    it('reports a missing TMDB list as a per-ID failure', async () => {
        fetchMock.mockResolvedValue(tmdbResponse({ status_message: 'not found' }, 404));
        const missing = await refreshCollection(createEvent(undefined, {
            ids: ['404'],
        }));
        expect(missing).toMatchObject({ statusCode: 207 });
        expect(responseBody(missing)).toMatchObject({
            failedCount: 1,
            results: [{
                collectionId: '404',
                success: false,
                statusCode: 404,
            }],
        });
        expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
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

        await refreshCollection(createEvent(undefined, { ids: ['8706524'] }));

        expect(ddbMock.commandCalls(UpdateCommand)[0].args[0].input)
            .toMatchObject({
                ExpressionAttributeValues: {
                    ':posterUrl': 'https://image.tmdb.org/t/p/w500/poster.jpg',
                    ':backdropUrl': 'https://image.tmdb.org/t/p/w1280/backdrop.jpg',
                    ':isActive': true,
                },
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
                isActive: false,
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
                isActive: false,
            },
            movies: [{ movieId: 1726, title: 'Movie 1726' }],
        });
        expect(responseBody(result).movies).toHaveLength(1);
    });

    it('lists sorted collection summaries without exposing their movie ID arrays', async () => {
        ddbMock.on(ScanCommand).resolves({
            Items: [
                {
                    collectionId: '20',
                    name: 'Zeta Collection',
                    description: 'Second collection.',
                    posterUrl: 'https://example.com/zeta.jpg',
                    backdropUrl: '',
                    movieIds: ['1', '2'],
                    lastUpdated: '2025-01-01T00:00:00.000Z',
                    isActive: false,
                },
                {
                    collectionId: '10',
                    name: 'Alpha Collection',
                    description: 'First collection.',
                    posterUrl: '',
                    backdropUrl: 'https://example.com/alpha.jpg',
                    movieIds: ['3'],
                },
            ],
        });

        const result = await listCollections(createEvent());

        expect(result).toMatchObject({ statusCode: 200 });
        expect(responseBody(result)).toEqual({
            collections: [
                {
                    collectionId: '10',
                    name: 'Alpha Collection',
                    description: 'First collection.',
                    posterUrl: '',
                    backdropUrl: 'https://example.com/alpha.jpg',
                    movieCount: 1,
                    isActive: true,
                },
                {
                    collectionId: '20',
                    name: 'Zeta Collection',
                    description: 'Second collection.',
                    posterUrl: 'https://example.com/zeta.jpg',
                    backdropUrl: '',
                    movieCount: 2,
                    lastUpdated: '2025-01-01T00:00:00.000Z',
                    isActive: false,
                },
            ],
        });
        expect(ddbMock.commandCalls(ScanCommand)[0].args[0].input.TableName)
            .toBe('test-collections');
    });

    it('returns an empty collection list when the table has no records', async () => {
        const result = await listCollections(createEvent());

        expect(result).toMatchObject({ statusCode: 200 });
        expect(responseBody(result)).toEqual({ collections: [] });
    });

    it('scans every collection table page', async () => {
        ddbMock.on(ScanCommand)
            .resolvesOnce({
                Items: [{
                    collectionId: '10',
                    name: 'Alpha Collection',
                    description: 'First collection.',
                    posterUrl: '',
                    backdropUrl: '',
                    movieIds: ['1'],
                    isActive: true,
                }],
                LastEvaluatedKey: { collectionId: '10' },
            })
            .resolves({
                Items: [{
                    collectionId: '20',
                    name: 'Beta Collection',
                    description: 'Second collection.',
                    posterUrl: '',
                    backdropUrl: '',
                    movieIds: ['2'],
                }],
            });

        const result = await listCollections(createEvent());
        const calls = ddbMock.commandCalls(ScanCommand);

        expect(result).toMatchObject({ statusCode: 200 });
        expect(responseBody(result).collections).toHaveLength(2);
        expect(calls).toHaveLength(2);
        expect(calls[1].args[0].input.ExclusiveStartKey).toEqual({
            collectionId: '10',
        });
    });

    it('returns an error when the collection table contains an invalid record', async () => {
        ddbMock.on(ScanCommand).resolves({
            Items: [{ collectionId: 'invalid' }],
        });

        const result = await listCollections(createEvent());

        expect(result).toMatchObject({ statusCode: 500 });
        expect(responseBody(result)).toMatchObject({
            message: 'Unable to retrieve movie collections.',
        });
    });

    it('sorts collections by ID when their names are identical', async () => {
        ddbMock.on(ScanCommand).resolves({
            Items: [
                {
                    collectionId: '20',
                    name: 'Same Name',
                    description: '',
                    posterUrl: '',
                    backdropUrl: '',
                    movieIds: [],
                },
                {
                    collectionId: '10',
                    name: 'Same Name',
                    description: '',
                    posterUrl: '',
                    backdropUrl: '',
                    movieIds: [],
                },
            ],
        });

        const result = await listCollections(createEvent());

        expect(responseBody(result).collections).toMatchObject([
            { collectionId: '10' },
            { collectionId: '20' },
        ]);
    });

    it('handles a non-Error collection-list failure without a request context', async () => {
        ddbMock.on(ScanCommand).callsFake(() => Promise.reject('scan failed'));

        const result = await listCollections({} as APIGatewayProxyEventV2);

        expect(result).toMatchObject({ statusCode: 500 });
        expect(responseBody(result)).toEqual({
            message: 'Unable to retrieve movie collections.',
        });
    });

    it('accepts base64 JSON bodies and TMDB items without a media type', async () => {
        fetchMock.mockResolvedValue(tmdbResponse({
            id: 8706524,
            name: 'Collection',
            page: 1,
            total_pages: 1,
            items: [{ id: 1726 }],
        }));
        const event = {
            ...createEvent(),
            body: Buffer.from(JSON.stringify({ ids: [8706524] })).toString('base64'),
            isBase64Encoded: true,
        } as APIGatewayProxyEventV2;

        const result = await refreshCollection(event);

        expect(result).toMatchObject({ statusCode: 200 });
        expect(ddbMock.commandCalls(UpdateCommand)[0].args[0].input)
            .toMatchObject({ ExpressionAttributeValues: { ':movieIds': ['1726'] } });
    });

    it.each([undefined, 'not-numeric'])(
        'rejects an invalid collection ID (%s)',
        async (id) => {
            const result = await getCollection(createEvent(id));

            expect(result).toMatchObject({ statusCode: 400 });
            expect(responseBody(result)).toEqual({
                message: 'A numeric collection ID is required.',
            });
            expect(ddbMock.commandCalls(GetCommand)).toHaveLength(0);
        }
    );

    it('returns not found for absent and malformed collection records', async () => {
        for (const response of [{}, { Item: { collectionId: '8706524' } }]) {
            ddbMock.reset();
            ddbMock.on(GetCommand).resolves(response);

            const result = await getCollection(createEvent('8706524'));

            expect(result).toMatchObject({ statusCode: 404 });
            expect(responseBody(result)).toEqual({
                message: 'TMDB list collection not found.',
            });
        }
    });

    it('defaults collection metadata and omits catalogue movies that are absent', async () => {
        ddbMock.on(GetCommand).resolves({
            Item: {
                collectionId: '8706524',
                name: 'Collection',
                description: '',
                posterUrl: '',
                backdropUrl: '',
                movieIds: ['999'],
            },
        });
        ddbMock.on(QueryCommand).resolves({ Items: [] });

        const result = await getCollection(createEvent('8706524'));

        expect(result).toMatchObject({ statusCode: 200 });
        expect(responseBody(result)).toEqual({
            collection: {
                collectionId: '8706524',
                name: 'Collection',
                description: '',
                posterUrl: '',
                backdropUrl: '',
                movieIds: ['999'],
                isActive: true,
            },
            movies: [],
        });
    });

    it('handles a catalogue query without an Items property', async () => {
        ddbMock.on(GetCommand).resolves({
            Item: {
                collectionId: '8706524',
                name: 'Collection',
                description: '',
                posterUrl: '',
                backdropUrl: '',
                movieIds: ['999'],
            },
        });
        ddbMock.on(QueryCommand).resolves({});

        const result = await getCollection(createEvent('8706524'));

        expect(result).toMatchObject({ statusCode: 200 });
        expect(responseBody(result).movies).toEqual([]);
    });

    it('includes the last update timestamp when present', async () => {
        ddbMock.on(GetCommand).resolves({
            Item: {
                collectionId: '8706524',
                name: 'Collection',
                description: '',
                posterUrl: '',
                backdropUrl: '',
                movieIds: [],
                lastUpdated: '2026-01-01T00:00:00.000Z',
            },
        });

        const result = await getCollection(createEvent('8706524'));

        expect(responseBody(result).collection).toMatchObject({
            lastUpdated: '2026-01-01T00:00:00.000Z',
        });
    });

    it('returns an error for duplicate or invalid catalogue movie records', async () => {
        for (const items of [
            [movie('1726'), movie('1726')],
            [{ ...movie('1726'), title: 42 }],
        ]) {
            ddbMock.reset();
            ddbMock.on(GetCommand).resolves({
                Item: {
                    collectionId: '8706524',
                    name: 'Collection',
                    description: '',
                    posterUrl: '',
                    backdropUrl: '',
                    movieIds: ['1726'],
                },
            });
            ddbMock.on(QueryCommand).resolves({ Items: items });

            const result = await getCollection(createEvent('8706524'));

            expect(result).toMatchObject({ statusCode: 500 });
            expect(responseBody(result)).toEqual({
                message: 'Unable to retrieve movie collection.',
            });
        }
    });

    it('handles a non-Error collection database failure', async () => {
        ddbMock.on(GetCommand).callsFake(() => Promise.reject('read failed'));

        const result = await getCollection(createEvent('8706524'));

        expect(result).toMatchObject({ statusCode: 500 });
        expect(responseBody(result)).toEqual({
            message: 'Unable to retrieve movie collection.',
        });
    });

    it.each([
        ['non-object payload', null],
        ['non-numeric list ID', { id: '8706524', name: 'Collection', page: 1, total_pages: 1, items: [] }],
        ['invalid name', { id: 8706524, name: 42, page: 1, total_pages: 1, items: [] }],
        ['invalid description', { id: 8706524, name: 'Collection', description: false, page: 1, total_pages: 1, items: [] }],
        ['invalid poster path', { id: 8706524, name: 'Collection', poster_path: false, page: 1, total_pages: 1, items: [] }],
        ['invalid backdrop path', { id: 8706524, name: 'Collection', backdrop_path: false, page: 1, total_pages: 1, items: [] }],
        ['invalid page number', { id: 8706524, name: 'Collection', page: 0, total_pages: 1, items: [] }],
        ['invalid total pages', { id: 8706524, name: 'Collection', page: 1, total_pages: 0, items: [] }],
        ['non-array items', { id: 8706524, name: 'Collection', page: 1, total_pages: 1, items: {} }],
        ['invalid item ID', { id: 8706524, name: 'Collection', page: 1, total_pages: 1, items: [{ id: 0 }] }],
        ['invalid item media type', { id: 8706524, name: 'Collection', page: 1, total_pages: 1, items: [{ id: 1726, media_type: 42 }] }],
        ['wrong list ID', { id: 42, name: 'Collection', page: 1, total_pages: 1, items: [] }],
        ['wrong page number', { id: 8706524, name: 'Collection', page: 2, total_pages: 2, items: [] }],
    ])('returns a gateway error for %s', async (_name, payload) => {
        fetchMock.mockResolvedValue(tmdbResponse(payload));

        const result = await refreshCollection(createEvent(undefined, {
            ids: ['8706524'],
        }));

        expect(result).toMatchObject({ statusCode: 207 });
        expect(responseBody(result).results).toMatchObject([{
            success: false,
            statusCode: 502,
            message: 'Unable to retrieve the TMDB list.',
        }]);
    });

    it('retries a transient TMDB response and converts fetch failures to item errors', async () => {
        fetchMock
            .mockResolvedValueOnce(new Response('', {
                status: 503,
                headers: { 'retry-after': '0.001' },
            }))
            .mockResolvedValueOnce(tmdbResponse({
                id: 8706524,
                name: 'Collection',
                page: 1,
                total_pages: 1,
                items: [],
            }));

        const retried = await refreshCollection(createEvent(undefined, {
            ids: ['8706524'],
        }));

        expect(retried).toMatchObject({ statusCode: 200 });
        expect(fetchMock).toHaveBeenCalledTimes(2);

        fetchMock.mockRejectedValueOnce('network failure');
        const failed = await refreshCollection(createEvent(undefined, {
            ids: ['8706524'],
        }));
        expect(failed).toMatchObject({ statusCode: 207 });
        expect(responseBody(failed).results).toMatchObject([{
            success: false,
            statusCode: 502,
        }]);
    });

    it('retries rate limits and rejects other unsuccessful or malformed responses', async () => {
        fetchMock
            .mockResolvedValueOnce(new Response('', { status: 429 }))
            .mockResolvedValueOnce(tmdbResponse({
                id: 8706524,
                name: 'Collection',
                page: 1,
                total_pages: 1,
                items: [],
            }));
        const retried = await refreshCollection(createEvent(undefined, {
            ids: ['8706524'],
        }));
        expect(retried).toMatchObject({ statusCode: 200 });
        expect(fetchMock).toHaveBeenCalledTimes(2);

        for (const response of [
            new Response('', { status: 400 }),
            new Response('{invalid json', { status: 200 }),
        ]) {
            fetchMock.mockResolvedValue(response);
            const failed = await refreshCollection(createEvent(undefined, {
                ids: ['8706524'],
            }));
            expect(failed).toMatchObject({ statusCode: 207 });
            expect(responseBody(failed).results).toMatchObject([{
                success: false,
                statusCode: 502,
            }]);
            fetchMock.mockReset();
        }
    });

    it('reports exhausted request timeouts as gateway failures', async () => {
        const timeout = Object.assign(new Error('request timed out'), {
            name: 'AbortError',
        });
        fetchMock.mockRejectedValue(timeout);

        const result = await refreshCollection(createEvent(undefined, {
            ids: ['8706524'],
        }));

        expect(result).toMatchObject({ statusCode: 207 });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(responseBody(result).results).toMatchObject([{
            success: false,
            statusCode: 502,
            message: 'Unable to retrieve the TMDB list.',
        }]);
    });
});
