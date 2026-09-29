import type {
    APIGatewayProxyEventV2,
    APIGatewayProxyResultV2,
} from 'aws-lambda';
import {
    DynamoDBDocumentClient,
    QueryCommand,
    TransactWriteCommand,
    UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';

process.env.TABLE_NAME = 'test-table';
process.env.MAX_BATCH = '25';
process.env.UPDATE_CONCURRENCY = '2';

const ddbMock = mockClient(DynamoDBDocumentClient);
const { handler } = require('../../main/lambda/handlers/update-movies-handler') as {
    handler: (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;
};

const movieRecord = {
    tmdbId: '123',
    slug: 'a-movie',
    title: 'A movie',
    visible: true,
    isComingSoon: false,
    isCarousel: false,
    genres: ['Drama'],
    rating: 'PG',
    score: 7,
    runtime: 100,
    releaseDate: '2025-01-02',
    poster: '',
    still: '',
    starring: [],
    director: 'Unknown',
    synopsis: '',
    trailer: '',
    showtimes: {},
};

function createEvent(body: string | undefined): APIGatewayProxyEventV2 {
    return {
        body,
        requestContext: { requestId: 'update-request-id' },
    } as unknown as APIGatewayProxyEventV2;
}

async function invoke(
    body: string | undefined
): Promise<Exclude<APIGatewayProxyResultV2, string>> {
    const result = await handler(createEvent(body));
    if (typeof result === 'string') {
        throw new Error('Expected a structured API Gateway response.');
    }
    return result;
}

function responseBody(
    result: Exclude<APIGatewayProxyResultV2, string>
): Record<string, any> {
    return JSON.parse(result.body as string);
}

describe('Update movies Lambda handler', () => {
    beforeEach(() => {
        ddbMock.reset();
        ddbMock.on(QueryCommand).callsFake((input) => ({
            Items: [{
                ...movieRecord,
                tmdbId: String(input.ExpressionAttributeValues?.[':tmdbId']),
            }],
        }));
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('applies only the supplied attribute to every unique movie ID', async () => {
        ddbMock.on(UpdateCommand).resolves({});

        const result = await invoke(
            JSON.stringify({ movieIds: [123, '123', 456], updates: { visible: false } })
        );
        const commands = ddbMock.commandCalls(UpdateCommand);

        expect(result.statusCode).toBe(200);
        expect(responseBody(result)).toMatchObject({
            summary: {
                total: 2,
                successCount: 2,
                failedCount: 0,
                dedupedFrom: 3,
            },
            successful: [
                { id: '123', status: 'SUCCESS' },
                { id: '456', status: 'SUCCESS' },
            ],
        });
        expect(commands).toHaveLength(2);
        expect(commands[0].args[0].input).toMatchObject({
            Key: { tmdbId: '123', slug: 'a-movie' },
            UpdateExpression: 'SET #field0 = :value0',
            ConditionExpression: 'attribute_exists(tmdbId) AND attribute_exists(slug)',
            ExpressionAttributeNames: { '#field0': 'visible' },
            ExpressionAttributeValues: { ':value0': false },
        });
    });

    it('updates multiple supported attributes while preserving their values', async () => {
        ddbMock.on(UpdateCommand).resolves({});

        const updates = { title: 'New title', genres: ['Drama', 'Comedy'], score: 8.5 };
        const result = await invoke(JSON.stringify({ movieIds: [123], updates }));

        expect(result.statusCode).toBe(200);
        expect(ddbMock.commandCalls(UpdateCommand)[0].args[0].input).toMatchObject({
            Key: { tmdbId: '123', slug: 'a-movie' },
            UpdateExpression: 'SET #field0 = :value0, #field1 = :value1, #field2 = :value2',
            ExpressionAttributeNames: {
                '#field0': 'title',
                '#field1': 'genres',
                '#field2': 'score',
            },
            ExpressionAttributeValues: {
                ':value0': 'New title',
                ':value1': ['Drama', 'Comedy'],
                ':value2': 8.5,
            },
        });
    });

    it('keeps the release-date index synchronized when releaseDate is changed', async () => {
        ddbMock.on(UpdateCommand).resolves({});

        await invoke(JSON.stringify({ movieIds: [123], updates: { releaseDate: '2030-04-05' } }));

        expect(ddbMock.commandCalls(UpdateCommand)[0].args[0].input).toMatchObject({
            Key: { tmdbId: '123', slug: 'a-movie' },
            UpdateExpression: 'SET #field0 = :value0, #gsi1sk = :gsi1sk',
            ExpressionAttributeNames: {
                '#field0': 'releaseDate',
                '#gsi1sk': 'GSI1SK',
            },
            ExpressionAttributeValues: {
                ':value0': '2030-04-05',
                ':gsi1sk': '2030-04-05#123',
            },
        });
    });

    it('moves a movie atomically when its slug changes', async () => {
        ddbMock.on(TransactWriteCommand).resolves({});

        const result = await invoke(
            JSON.stringify({ movieIds: [123], updates: { slug: 'new-slug' } })
        );
        const transaction = ddbMock.commandCalls(TransactWriteCommand)[0].args[0].input;

        expect(result.statusCode).toBe(200);
        expect(transaction.TransactItems).toMatchObject([
            {
                Delete: { Key: { tmdbId: '123', slug: 'a-movie' } },
            },
            {
                Put: {
                    Item: { tmdbId: '123', slug: 'new-slug' },
                },
            },
        ]);
        expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
    });

    it('reports a missing movie without attempting an update', async () => {
        ddbMock.on(QueryCommand).resolves({ Items: [] });

        const result = await invoke(
            JSON.stringify({ movieIds: [123], updates: { visible: false } })
        );

        expect(responseBody(result).failed).toEqual([
            { id: '123', status: 'FAILED', error: 'Movie not found.' },
        ]);
        expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
    });

    it.each([
        ['empty updates', { movieIds: [123], updates: {} }],
        ['unknown attribute', { movieIds: [123], updates: { tmdbId: '456' } }],
        ['incorrect value type', { movieIds: [123], updates: { visible: 'false' } }],
        ['empty slug', { movieIds: [123], updates: { slug: '' } }],
        ['empty IDs', { movieIds: [], updates: { title: 'New title' } }],
        ['nonnumeric ID', { movieIds: ['12x'], updates: { title: 'New title' } }],
    ])('rejects %s without writing', async (_name, request) => {
        const result = await invoke(JSON.stringify(request));

        expect(result.statusCode).toBe(400);
        expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
    });

    it('returns 400 when the request body is invalid JSON', async () => {
        const result = await invoke('{invalid');

        expect(result.statusCode).toBe(400);
        expect(responseBody(result)).toEqual({
            message: 'Request body is not valid JSON.',
        });
    });

    it('reports per-movie write failures without failing the rest of the batch', async () => {
        ddbMock.on(UpdateCommand).callsFake((input) => {
            if (input.Key?.tmdbId === '123') {
                throw new Error('Movie does not exist');
            }
            return {};
        });

        const result = await invoke(
            JSON.stringify({ movieIds: [123, 456], updates: { poster: 'poster-url' } })
        );

        expect(result.statusCode).toBe(200);
        expect(responseBody(result)).toMatchObject({
            summary: { total: 2, successCount: 1, failedCount: 1 },
            failed: [{ id: '123', status: 'FAILED', error: 'Movie does not exist' }],
            successful: [{ id: '456', status: 'SUCCESS' }],
        });
    });
});
