import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';

process.env.TABLE_NAME = 'test-movies-table';

const ddbMock = mockClient(DynamoDBDocumentClient);
const { handler: exportMovies } = require('../../main/lambda/handlers/export-movies-handler') as {
    handler: (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;
};
const { handler: listTmdbIds } = require('../../main/lambda/handlers/list-tmdb-ids-handler') as {
    handler: (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;
};

function createEvent(): APIGatewayProxyEventV2 {
    return {
        requestContext: { requestId: 'export-movies-test-request' },
    } as unknown as APIGatewayProxyEventV2;
}

function responseBody(result: APIGatewayProxyResultV2): Record<string, unknown> {
    if (typeof result === 'string') {
        throw new Error('Expected a structured API Gateway response.');
    }
    return JSON.parse(result.body as string) as Record<string, unknown>;
}

describe('DynamoDB export handlers', () => {
    beforeEach(() => {
        ddbMock.reset();
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('exports every item across all scan pages', async () => {
        const firstPage = [{ tmdbId: '123', slug: 'first' }];
        const secondPage = [{ tmdbId: '456', slug: 'second' }];
        const lastEvaluatedKey = { tmdbId: '123', slug: 'first' };
        ddbMock
            .on(ScanCommand)
            .resolvesOnce({ Items: firstPage, LastEvaluatedKey: lastEvaluatedKey })
            .resolvesOnce({ Items: secondPage });

        const result = await exportMovies(createEvent());

        expect(result).toMatchObject({ statusCode: 200 });
        expect(responseBody(result)).toEqual({ movies: [...firstPage, ...secondPage] });
        expect(ddbMock.commandCalls(ScanCommand)).toHaveLength(2);
        expect(ddbMock.commandCalls(ScanCommand)[1].args[0].input.ExclusiveStartKey).toEqual(
            lastEvaluatedKey
        );
    });

    it('returns distinct TMDB IDs from every scan page', async () => {
        const lastEvaluatedKey = { tmdbId: '123', slug: 'first' };
        ddbMock
            .on(ScanCommand)
            .resolvesOnce({
                Items: [{ tmdbId: '123' }, { tmdbId: '456' }],
                LastEvaluatedKey: lastEvaluatedKey,
            })
            .resolvesOnce({ Items: [{ tmdbId: '123' }, { tmdbId: '789' }] });

        const result = await listTmdbIds(createEvent());

        expect(result).toMatchObject({ statusCode: 200 });
        expect(responseBody(result)).toEqual({ tmdbIds: ['123', '456', '789'] });
        expect(ddbMock.commandCalls(ScanCommand)[0].args[0].input).toMatchObject({
            TableName: 'test-movies-table',
            ProjectionExpression: '#tmdbId',
            ExpressionAttributeNames: { '#tmdbId': 'tmdbId' },
        });
        expect(ddbMock.commandCalls(ScanCommand)[1].args[0].input.ExclusiveStartKey).toEqual(
            lastEvaluatedKey
        );
    });

    it('returns an error response when a scan fails', async () => {
        ddbMock.on(ScanCommand).rejects(new Error('DynamoDB unavailable'));

        const result = await exportMovies(createEvent());

        expect(result).toMatchObject({ statusCode: 500 });
        expect(responseBody(result)).toEqual({ message: 'Unable to export movies.' });
    });

    it('returns empty results when scans omit Items and request context', async () => {
        ddbMock.on(ScanCommand).resolves({});
        const event = {} as APIGatewayProxyEventV2;

        const movies = await exportMovies(event);
        const tmdbIds = await listTmdbIds(event);

        expect(responseBody(movies)).toEqual({ movies: [] });
        expect(responseBody(tmdbIds)).toEqual({ tmdbIds: [] });
    });

    it('returns an error response when TMDB ID scanning fails', async () => {
        ddbMock.on(ScanCommand).callsFake(() => Promise.reject('DynamoDB unavailable'));

        const result = await listTmdbIds(createEvent());

        expect(result).toMatchObject({ statusCode: 500 });
        expect(responseBody(result)).toEqual({ message: 'Unable to retrieve TMDB IDs.' });
    });
});
