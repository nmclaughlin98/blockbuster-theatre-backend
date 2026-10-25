import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';

process.env.TABLE_NAME = 'test-movies-table';

const ddbMock = mockClient(DynamoDBDocumentClient);
const { handler } = require(
    '../../main/lambda/handlers/list-featured-movies-handler'
) as {
    handler: (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;
};

const movieRecord = {
    tmdbId: '456',
    slug: 'a-movie',
    title: 'A Movie',
    visible: true,
    isComingSoon: false,
    genres: ['Adventure', 'Drama'],
    rating: 'PG',
    score: 8.4,
    runtime: 110,
    releaseDate: '2026-09-25T00:00:00.000Z',
    poster: 'https://example.com/poster.jpg',
    still: 'https://example.com/still.jpg',
    starring: ['Actor One'],
    director: 'Director Name',
    synopsis: 'A short description.',
    trailer: 'https://www.youtube-nocookie.com/embed/example',
    showtimes: {},
    GSI1PK: 'MOVIE',
    GSI1SK: '2026-09-25#456',
};

function createEvent(
    routeKey: string,
    queryStringParameters?: Record<string, string>
): APIGatewayProxyEventV2 {
    return {
        routeKey,
        queryStringParameters,
        requestContext: { requestId: 'featured-movies-test-request' },
    } as unknown as APIGatewayProxyEventV2;
}

function responseBody(result: APIGatewayProxyResultV2): Record<string, any> {
    if (typeof result === 'string') {
        throw new Error('Expected a structured API Gateway response.');
    }
    return JSON.parse(result.body as string);
}

describe('Featured movie endpoints', () => {
    beforeEach(() => {
        ddbMock.reset();
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('queries newest movies by release date and excludes coming-soon records', async () => {
        const lastEvaluatedKey = {
            tmdbId: '456',
            slug: 'a-movie',
            GSI1PK: 'MOVIE',
            GSI1SK: '2026-09-25#456',
        };
        ddbMock.on(QueryCommand).resolves({
            Items: [movieRecord],
            LastEvaluatedKey: lastEvaluatedKey,
        });

        const result = await handler(createEvent('GET /movies/newest', { limit: '12' }));

        expect(result).toMatchObject({ statusCode: 200 });
        expect(responseBody(result).movies).toMatchObject([{
            movieId: 456,
            title: 'A Movie',
            releaseDate: '2026-09-25',
        }]);
        expect(responseBody(result).nextToken).toBe(
            Buffer.from(JSON.stringify(lastEvaluatedKey)).toString('base64url')
        );
        expect(ddbMock.commandCalls(QueryCommand)[0].args[0].input).toMatchObject({
            TableName: 'test-movies-table',
            IndexName: 'GSI1',
            KeyConditionExpression: 'GSI1PK = :movie',
            FilterExpression:
                'attribute_not_exists(isComingSoon) OR isComingSoon = :notComingSoon',
            ExpressionAttributeValues: {
                ':movie': 'MOVIE',
                ':notComingSoon': false,
            },
            Limit: 12,
            ScanIndexForward: false,
        });
    });

    it('uses newest cursor tokens and includes legacy movies without a coming-soon flag', async () => {
        const cursor = {
            tmdbId: '123',
            slug: 'legacy-movie',
            GSI1PK: 'MOVIE',
            GSI1SK: '2025-01-02#123',
        };
        const legacyMovie = { ...movieRecord };
        Reflect.deleteProperty(legacyMovie, 'isComingSoon');
        ddbMock.on(QueryCommand).resolves({ Items: [legacyMovie] });

        const result = await handler(createEvent('GET /movies/newest', {
            nextToken: Buffer.from(JSON.stringify(cursor)).toString('base64url'),
        }));

        expect(result).toMatchObject({ statusCode: 200 });
        expect(responseBody(result).movies).toMatchObject([{ isComingSoon: false }]);
        expect(ddbMock.commandCalls(QueryCommand)[0].args[0].input.ExclusiveStartKey)
            .toEqual(cursor);
        expect(ddbMock.commandCalls(QueryCommand)[0].args[0].input.Limit).toBe(50);
    });

    it('queries top picks by descending numeric score', async () => {
        const lastEvaluatedKey = {
            tmdbId: '456',
            slug: 'a-movie',
            GSI1PK: 'MOVIE',
            score: 8.4,
        };
        ddbMock.on(QueryCommand).resolves({
            Items: [movieRecord, { ...movieRecord, tmdbId: '789', score: 7.5 }],
            LastEvaluatedKey: lastEvaluatedKey,
        });

        const result = await handler(createEvent('GET /movies/top-picks'));

        expect(result).toMatchObject({ statusCode: 200 });
        expect(responseBody(result).movies.map((movie: { score: number }) => movie.score))
            .toEqual([8.4, 7.5]);
        expect(ddbMock.commandCalls(QueryCommand)[0].args[0].input).toMatchObject({
            IndexName: 'GSI2',
            KeyConditionExpression: 'GSI1PK = :movie',
            ExpressionAttributeValues: { ':movie': 'MOVIE' },
            Limit: 50,
            ScanIndexForward: false,
        });
        expect(ddbMock.commandCalls(QueryCommand)[0].args[0].input)
            .not.toHaveProperty('FilterExpression');
    });

    it('uses top-picks cursor tokens', async () => {
        const cursor = {
            tmdbId: '123',
            slug: 'a-movie',
            GSI1PK: 'MOVIE',
            score: 8.4,
        };
        ddbMock.on(QueryCommand).resolves({});

        const result = await handler(createEvent('GET /movies/top-picks', {
            nextToken: Buffer.from(JSON.stringify(cursor)).toString('base64url'),
        }));

        expect(result).toMatchObject({ statusCode: 200 });
        expect(ddbMock.commandCalls(QueryCommand)[0].args[0].input.ExclusiveStartKey)
            .toEqual(cursor);
        expect(responseBody(result)).toEqual({ movies: [], nextToken: null });
    });

    it.each([
        ['invalid limit', 'GET /movies/newest', { limit: '0' }],
        ['malformed token', 'GET /movies/newest', { nextToken: 'not-json' }],
        [
            'cursor from another endpoint',
            'GET /movies/top-picks',
            {
                nextToken: Buffer.from(JSON.stringify({
                    tmdbId: '123',
                    slug: 'a-movie',
                    GSI1PK: 'MOVIE',
                    GSI1SK: '2025-01-01#123',
                })).toString('base64url'),
            },
        ],
    ])('rejects %s before querying DynamoDB', async (_name, routeKey, query) => {
        const result = await handler(createEvent(routeKey, query));

        expect(result).toMatchObject({ statusCode: 400 });
        expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
    });

    it('returns not found for unsupported routes', async () => {
        const result = await handler(createEvent('GET /movies'));

        expect(result).toMatchObject({ statusCode: 404 });
        expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
    });

    it('returns an error when DynamoDB returns an invalid movie', async () => {
        ddbMock.on(QueryCommand).resolves({
            Items: [{ ...movieRecord, score: 'high' }],
        });

        const result = await handler(createEvent('GET /movies/top-picks'));

        expect(result).toMatchObject({ statusCode: 500 });
        expect(responseBody(result)).toEqual({
            message: 'Unable to retrieve top-picks movies.',
        });
    });

    it('returns an error when DynamoDB rejects a query', async () => {
        ddbMock.on(QueryCommand).callsFake(() => Promise.reject('database failure'));

        const result = await handler(createEvent('GET /movies/newest'));

        expect(result).toMatchObject({ statusCode: 500 });
        expect(responseBody(result)).toEqual({
            message: 'Unable to retrieve newest movies.',
        });
    });
});
