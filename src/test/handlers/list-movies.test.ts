import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';

process.env.TABLE_NAME = 'test-movies-table';

const ddbMock = mockClient(DynamoDBDocumentClient);
const { handler } = require('../../main/lambda/handlers/list-movies-handler') as {
    handler: (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;
};

const movieRecord = {
    tmdbId: '456',
    slug: 'a-movie',
    title: 'A Movie',
    visible: true,
    isComingSoon: true,
    genres: ['Adventure', 'Drama'],
    rating: 'PG',
    score: 7.4,
    runtime: 110,
    releaseDate: '2026-09-25T00:00:00.000Z',
    poster: 'https://example.com/poster.jpg',
    still: 'https://example.com/still.jpg',
    starring: ['Actor One'],
    director: 'Director Name',
    synopsis: 'A short description.',
    trailer: 'https://www.youtube-nocookie.com/embed/example',
    showtimes: { Monday: ['11:00', '19:00'] },
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
        expect(body.movies).toEqual([
            {
                slug: 'a-movie',
                movieId: 456,
                title: 'A Movie',
                visible: true,
                isComingSoon: true,
                poster: 'https://example.com/poster.jpg',
                rating: 'PG',
                runtime: 110,
                genres: ['Adventure', 'Drama'],
                releaseDate: '2026-09-25',
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

    it('treats existing records without the flag as released', async () => {
        const legacyMovieRecord = { ...movieRecord };
        Reflect.deleteProperty(legacyMovieRecord, 'isComingSoon');
        ddbMock.on(QueryCommand).resolves({ Items: [legacyMovieRecord] });

        const result = await handler(createEvent());

        expect(result).toMatchObject({ statusCode: 200 });
        expect(responseBody(result).movies).toMatchObject([{ isComingSoon: false }]);
    });

    it.each([
        [{ limit: '0' }, 'limit must be an integer between 1 and 100.'],
        [{ limit: '101' }, 'limit must be an integer between 1 and 100.'],
        [{ nextToken: 'not-a-valid-token' }, 'nextToken is invalid.'],
    ])('rejects invalid pagination parameters %o', async (query, message) => {
        const result = await handler(createEvent(query));

        expect(result).toMatchObject({ statusCode: 400 });
        expect(responseBody(result)).toEqual({ message });
        expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
    });
});
