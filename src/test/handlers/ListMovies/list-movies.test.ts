import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';

process.env.TABLE_NAME = 'test-movies-table';

const ddbMock = mockClient(DynamoDBDocumentClient);
const { handler } = require('../../../main/lambda/handlers/ListMovies/list-movies-handler') as {
    handler: (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;
};

const movieRecord = {
    tmdbId: '456',
    slug: 'a-movie',
    title: 'A Movie',
    visible: true,
    genres: ['Adventure', 'Drama'],
    rating: 'PG',
    score: 7.4,
    runtime: 110,
    releaseDate: '2030-09-25T00:00:00.000Z',
    startDate: '2030-09-25',
    poster: 'https://example.com/poster.jpg',
    still: 'https://example.com/still.jpg',
    starring: ['Actor One'],
    director: 'Director Name',
    synopsis: 'A short description.',
    trailer: 'https://www.youtube-nocookie.com/embed/example',
};

function createEvent(
    queryStringParameters?: Record<string, string>
): APIGatewayProxyEventV2 {
    return {
        queryStringParameters,
        requestContext: { requestId: 'list-movies-test-request' },
    } as unknown as APIGatewayProxyEventV2;
}

function responseBody(result: APIGatewayProxyResultV2): Record<string, unknown> {
    if (typeof result === 'string') {
        throw new Error('Expected a structured API Gateway response.');
    }
    return JSON.parse(result.body as string) as Record<string, unknown>;
}

describe('List movies Lambda handler', () => {
    beforeEach(() => {
        ddbMock.reset();
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('queries the movies index and returns a page and continuation token', async () => {
        const lastEvaluatedKey = {
            tmdbId: '123',
            slug: 'movie-123',
            GSI1PK: 'MOVIE',
            GSI1SK: '2025-01-02#123',
        };
        ddbMock.on(QueryCommand).resolves({
            Items: [movieRecord],
            LastEvaluatedKey: lastEvaluatedKey,
        });

        const result = await handler(createEvent({ limit: '25' }));
        const body = responseBody(result);
        const nextToken = body.nextToken;

        expect(result).toMatchObject({ statusCode: 200 });
        expect(body.movies).toMatchObject([
            {
                slug: 'a-movie',
                sortTitle: 'A Movie',
                movieId: 456,
                title: 'A Movie',
                visible: true,
                isComingSoon: true,
                lifecycleStatus: 'Coming Soon (No Showtimes Yet)',
                poster: 'https://example.com/poster.jpg',
                rating: 'PG',
                runtime: 110,
                genres: ['Adventure', 'Drama'],
                releaseDate: '2030-09-25',
                startDate: '2030-09-25',
                preSalesEligible: false,
                score: 7.4,
            },
        ]);
        expect(typeof nextToken).toBe('string');
        expect(JSON.parse(Buffer.from(String(nextToken), 'base64url').toString('utf8'))).toEqual(
            lastEvaluatedKey
        );
        expect(ddbMock.commandCalls(QueryCommand)[0].args[0].input).toMatchObject({
            TableName: 'test-movies-table',
            IndexName: 'GSI1',
            KeyConditionExpression: 'GSI1PK = :movie',
            ExpressionAttributeValues: { ':movie': 'MOVIE' },
            Limit: 25,
            ScanIndexForward: false,
        });
    });

    it('uses the continuation token for the next page', async () => {
        const cursor = {
            tmdbId: '123',
            slug: 'movie-123',
            GSI1PK: 'MOVIE',
            GSI1SK: '2025-01-02#123',
        };
        ddbMock.on(QueryCommand).resolves({ Items: [] });

        const result = await handler(
            createEvent({
                nextToken: Buffer.from(JSON.stringify(cursor)).toString('base64url'),
            })
        );

        expect(result).toMatchObject({ statusCode: 200 });
        expect(ddbMock.commandCalls(QueryCommand)[0].args[0].input.ExclusiveStartKey).toEqual(
            cursor
        );
    });

    it('filters hidden records while preserving explicit per-query limits', async () => {
        const key = { tmdbId: '456', slug: 'a-movie', GSI1PK: 'MOVIE', GSI1SK: 'first' };
        ddbMock.on(QueryCommand).resolves({
            Items: [{ ...movieRecord, visible: false }, movieRecord],
            LastEvaluatedKey: key,
        });

        const result = await handler(createEvent({ limit: '2' }));
        expect(responseBody(result)).toMatchObject({
            movies: [{ movieId: 456 }],
            nextToken: Buffer.from(JSON.stringify(key)).toString('base64url'),
        });
        expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(1);
    });

    it('combines DynamoDB pages in order, excluding hidden movies and retaining the summary shape', async () => {
        const records = Array.from({ length: 37 }, (_, index) => ({
            ...movieRecord,
            tmdbId: String(1000 + index),
            slug: `movie-${index}`,
            title: `Movie ${index}`,
            visible: index !== 2 && index !== 22,
        }));
        const legacy = { ...records[12] };
        Reflect.deleteProperty(legacy, 'visible');
        records[12] = legacy;
        const key1 = { tmdbId: '1014', slug: 'movie-14', GSI1PK: 'MOVIE', GSI1SK: '14' };
        const key2 = { tmdbId: '1029', slug: 'movie-29', GSI1PK: 'MOVIE', GSI1SK: '29' };
        ddbMock.on(QueryCommand)
            .resolvesOnce({ Items: records.slice(0, 15), LastEvaluatedKey: key1 })
            .resolvesOnce({ Items: [], LastEvaluatedKey: key2 })
            .resolvesOnce({ Items: records.slice(15) });

        const result = await handler(createEvent());
        const body = responseBody(result);
        const movies = body.movies as Array<Record<string, unknown>>;
        expect(result).toMatchObject({ statusCode: 200 });
        expect(body.nextToken).toBeNull();
        expect(movies.map((movie) => movie.movieId)).toEqual(
            records.filter((record) => record.visible !== false).map((record) => Number(record.tmdbId))
        );
        expect(new Set(movies.map((movie) => movie.movieId)).size).toBe(35);
        expect(movies[11]).toMatchObject({ movieId: 1012, visible: true });
        expect(movies[0]).toMatchObject({
            slug: 'movie-0',
            sortTitle: 'Movie 0',
            movieId: 1000,
            title: 'Movie 0',
            visible: true,
            isComingSoon: true,
            lifecycleStatus: 'Coming Soon (No Showtimes Yet)',
            isCarousel: false,
            trailer: movieRecord.trailer,
            synopsis: movieRecord.synopsis,
            still: movieRecord.still,
            poster: movieRecord.poster,
            rating: movieRecord.rating,
            runtime: movieRecord.runtime,
            genres: movieRecord.genres,
            releaseDate: '2030-09-25',
            startDate: '2030-09-25',
            preSalesEligible: false,
            score: movieRecord.score,
        });
        expect(Object.keys(movies[0].showtimes as object).length).toBeGreaterThan(0);
        expect(ddbMock.commandCalls(QueryCommand).map((call) => call.args[0].input.ExclusiveStartKey))
            .toEqual([undefined, key1, key2]);
        expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThan(4 * 1024 * 1024);
    });

    it('returns a continuation at a page boundary before exceeding the proxy response budget', async () => {
        const key = { tmdbId: '456', slug: 'a-movie', GSI1PK: 'MOVIE', GSI1SK: 'first' };
        const first = { ...movieRecord, synopsis: '\0'.repeat(320_000) };
        const second = { ...movieRecord, tmdbId: '457', slug: 'next', synopsis: '\0'.repeat(320_000) };
        ddbMock.on(QueryCommand)
            .resolvesOnce({ Items: [first], LastEvaluatedKey: key })
            .resolvesOnce({ Items: [second] })
            .resolvesOnce({ Items: [second] });

        const result = await handler(createEvent());
        const body = responseBody(result);
        expect((body.movies as unknown[])).toHaveLength(1);
        expect(body.nextToken).toEqual(Buffer.from(JSON.stringify(key)).toString('base64url'));
        expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(4 * 1024 * 1024);

        const next = await handler(createEvent({ nextToken: String(body.nextToken) }));
        expect(responseBody(next)).toMatchObject({ movies: [{ movieId: 457 }], nextToken: null });
        expect(ddbMock.commandCalls(QueryCommand)[2].args[0].input.ExclusiveStartKey).toEqual(key);
    });

    it('splits an oversized DynamoDB page without losing or duplicating movies', async () => {
        const records = Array.from({ length: 3 }, (_, index) => ({
            ...movieRecord,
            tmdbId: String(500 + index),
            slug: `large-${index}`,
            GSI1PK: 'MOVIE',
            GSI1SK: `large-${index}`,
            synopsis: '\0'.repeat(205_000),
        }));
        ddbMock.on(QueryCommand)
            .resolvesOnce({ Items: records })
            .resolvesOnce({ Items: records.slice(2) });

        const first = await handler(createEvent());
        const body = responseBody(first);
        expect((body.movies as Array<{ movieId: number }>).map((movie) => movie.movieId)).toEqual([500, 501]);
        expect(Buffer.byteLength(JSON.stringify(first), 'utf8')).toBeLessThanOrEqual(4 * 1024 * 1024);
        const cursor = { tmdbId: '501', slug: 'large-1', GSI1PK: 'MOVIE', GSI1SK: 'large-1' };
        expect(JSON.parse(Buffer.from(String(body.nextToken), 'base64url').toString('utf8'))).toEqual(cursor);
        const second = await handler(createEvent({ nextToken: String(body.nextToken) }));
        expect(responseBody(second)).toMatchObject({ movies: [{ movieId: 502 }], nextToken: null });
        expect(ddbMock.commandCalls(QueryCommand)[1].args[0].input.ExclusiveStartKey).toEqual(cursor);
    });

    it('returns a token after the bounded number of DynamoDB pages', async () => {
        const key = { tmdbId: '123', slug: 'movie-123', GSI1PK: 'MOVIE', GSI1SK: '2025#123' };
        ddbMock.on(QueryCommand).resolves({ Items: [], LastEvaluatedKey: key });
        const result = await handler(createEvent());
        expect(responseBody(result)).toEqual({
            movies: [],
            nextToken: Buffer.from(JSON.stringify(key)).toString('base64url'),
        });
        expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(20);
    });

    it('derives lifecycle for records without the legacy flag', async () => {
        const legacyMovieRecord = { ...movieRecord };
        Reflect.deleteProperty(legacyMovieRecord, 'isComingSoon');
        ddbMock.on(QueryCommand).resolves({ Items: [legacyMovieRecord] });

        const result = await handler(createEvent());

        expect(result).toMatchObject({ statusCode: 200 });
        expect(responseBody(result).movies).toMatchObject([{
            isComingSoon: true,
            lifecycleStatus: 'Coming Soon (No Showtimes Yet)',
        }]);
    });

    it.each([
        [{ limit: '0' }, 'limit must be an integer between 1 and 100.'],
        [{ limit: '101' }, 'limit must be an integer between 1 and 100.'],
        [{ limit: '2.5' }, 'limit must be an integer between 1 and 100.'],
        [{ nextToken: 'not-a-valid-token' }, 'nextToken is invalid.'],
        [{ nextToken: Buffer.from('{}').toString('base64url') }, 'nextToken is invalid.'],
    ])('rejects invalid pagination parameters %o', async (query, message) => {
        const result = await handler(createEvent(query));

        expect(result).toMatchObject({ statusCode: 400 });
        expect(responseBody(result)).toEqual({ message });
        expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
    });

    it('rejects an invalid movie record returned by DynamoDB', async () => {
        ddbMock.on(QueryCommand).resolves({
            Items: [{ ...movieRecord, title: 42 }],
        });

        const result = await handler(createEvent());

        expect(result).toMatchObject({ statusCode: 500 });
        expect(responseBody(result)).toEqual({
            message: 'Unable to retrieve movies.',
        });
    });

    it('returns an error response when DynamoDB rejects the query', async () => {
        ddbMock.on(QueryCommand).rejects(new Error('DynamoDB unavailable'));

        const result = await handler(createEvent());

        expect(result).toMatchObject({ statusCode: 500 });
        expect(responseBody(result)).toEqual({
            message: 'Unable to retrieve movies.',
        });
    });

    it('does not return a partial success if a later DynamoDB page fails', async () => {
        const key = { tmdbId: '456', slug: 'a-movie', GSI1PK: 'MOVIE', GSI1SK: 'first' };
        ddbMock.on(QueryCommand)
            .resolvesOnce({ Items: [movieRecord], LastEvaluatedKey: key })
            .rejectsOnce(new Error('DynamoDB unavailable'));

        const result = await handler(createEvent());
        expect(result).toMatchObject({ statusCode: 500 });
        expect(responseBody(result)).toEqual({ message: 'Unable to retrieve movies.' });
    });

    it('returns an empty page when DynamoDB omits Items', async () => {
        ddbMock.on(QueryCommand).resolves({});

        const result = await handler(createEvent());

        expect(result).toMatchObject({ statusCode: 200 });
        expect(responseBody(result)).toEqual({
            movies: [],
            nextToken: null,
        });
    });
});
