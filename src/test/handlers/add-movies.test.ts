import type {
    APIGatewayProxyEventV2,
    APIGatewayProxyResultV2,
} from 'aws-lambda';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';

process.env.TABLE_NAME = 'test-table';
process.env.TMDB_API_KEY = 'test-token';
process.env.MAX_BATCH = '25';
process.env.TMDB_CONCURRENCY = '2';
process.env.TMDB_TIMEOUT_MS = '1000';
process.env.TMDB_RETRIES = '2';

const ddbMock = mockClient(DynamoDBDocumentClient);
const { handler } = require('../../main/lambda/handlers/add-movies-handler') as {
    handler: (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;
};

const fetchMock: jest.MockedFunction<typeof fetch> = jest.fn();
global.fetch = fetchMock;

function createEvent(body: string | undefined): APIGatewayProxyEventV2 {
    return {
        body,
        requestContext: { requestId: 'test-request-id' },
    } as unknown as APIGatewayProxyEventV2;
}

function structuredResult(
    result: APIGatewayProxyResultV2
): Exclude<APIGatewayProxyResultV2, string> {
    if (typeof result === 'string') {
        throw new Error('Expected a structured API Gateway response.');
    }
    return result;
}

async function invoke(
    body: string | undefined
): Promise<Exclude<APIGatewayProxyResultV2, string>> {
    return structuredResult(await handler(createEvent(body)));
}

function tmdbMovie(id: number) {
    return {
        id,
        title: `Movie ${id}`,
        genres: [{ name: 'Drama' }],
        vote_average: 7.8,
        runtime: 100,
        release_date: '2025-01-02',
        overview: 'A test movie',
        poster_path: '/poster.jpg',
        backdrop_path: '/backdrop.jpg',
        credits: {
            cast: [{ name: 'Test Actor' }],
            crew: [{ name: 'Test Director', job: 'Director' }],
        },
    };
}

function tmdbResponse(
    body: unknown,
    status = 200,
    responseHeaders: HeadersInit = { 'Content-Type': 'application/json' }
): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: responseHeaders,
    });
}

function loadHandlerWithEnvironment(
    overrides: Record<string, string | undefined>
): typeof handler {
    const environment = new Map<string, string | undefined>();
    for (const [name, value] of Object.entries(overrides)) {
        environment.set(name, process.env[name]);
        if (value === undefined) {
            delete process.env[name];
        } else {
            process.env[name] = value;
        }
    }

    try {
        jest.resetModules();
        return (
            require('../../main/lambda/handlers/add-movies-handler') as {
                handler: typeof handler;
            }
        ).handler;
    } finally {
        for (const [name, value] of environment) {
            if (value === undefined) {
                delete process.env[name];
            } else {
                process.env[name] = value;
            }
        }
    }
}

function responseBody(
    result: Exclude<APIGatewayProxyResultV2, string>
): Record<string, any> {
    return JSON.parse(result.body as string);
}

describe('Add movies Lambda handler', () => {
    beforeEach(() => {
        ddbMock.reset();
        fetchMock.mockReset();
        fetchMock.mockResolvedValue(tmdbResponse(tmdbMovie(123)));
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('returns 400 when the request body is missing', async () => {
        const result = await invoke(undefined);

        expect(result.statusCode).toBe(400);
        expect(responseBody(result)).toEqual({ message: 'Missing request body.' });
    });

    it('returns 400 when the request body is invalid JSON', async () => {
        const result = await invoke('{invalid');

        expect(result.statusCode).toBe(400);
        expect(responseBody(result)).toEqual({
            message: 'Request body is not valid JSON.',
        });
    });

    it('rejects empty, oversized, and non-numeric movie ID batches', async () => {
        const emptyResult = await invoke(JSON.stringify({ movieIds: [] }));
        expect(emptyResult.statusCode).toBe(400);
        expect(responseBody(emptyResult).message).toBe(
            'movieIds must be a non-empty array.'
        );

        const nullBodyResult = await invoke('null');
        expect(nullBodyResult.statusCode).toBe(400);

        const oversizedResult = await invoke(
            JSON.stringify({ movieIds: Array.from({ length: 26 }, (_, i) => i + 1) })
        );
        expect(oversizedResult.statusCode).toBe(400);
        expect(responseBody(oversizedResult).message).toBe(
            'movieIds cannot exceed 25 items per request.'
        );

        const invalidResult = await invoke(JSON.stringify({ movieIds: ['12x'] }));
        expect(invalidResult.statusCode).toBe(400);
        expect(responseBody(invalidResult)).toMatchObject({
            message: 'All movieIds must be numeric TMDB IDs.',
            invalid: ['12x'],
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fetches and upserts unique movie IDs and reports the batch summary', async () => {
        fetchMock.mockImplementation(async (input) => {
            const id = Number(new URL(String(input)).pathname.split('/').pop());
            return tmdbResponse(tmdbMovie(id));
        });
        ddbMock.on(UpdateCommand).resolves({});

        const result = await invoke(JSON.stringify({ movieIds: [123, '123', 456] }));
        const body = responseBody(result);

        expect(result.statusCode).toBe(200);
        expect(body.summary).toEqual({
            total: 2,
            successCount: 2,
            failedCount: 0,
            dedupedFrom: 3,
        });
        expect(body.successful).toEqual([
            { id: '123', status: 'SUCCESS', title: 'Movie 123' },
            { id: '456', status: 'SUCCESS', title: 'Movie 456' },
        ]);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(
            new Headers(fetchMock.mock.calls[0][1]?.headers).get('Authorization')
        ).toBe('Bearer test-token');
        expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(2);
    });

    it('reports a failed movie when TMDB does not find the ID', async () => {
        fetchMock.mockResolvedValue(tmdbResponse({ status_message: 'Not found' }, 404));

        const result = await invoke(JSON.stringify({ movieIds: [987] }));
        const body = responseBody(result);

        expect(result.statusCode).toBe(200);
        expect(body.summary).toMatchObject({ total: 1, successCount: 0, failedCount: 1 });
        expect(body.failed).toEqual([
            { id: '987', status: 'FAILED', error: 'Movie not found on TMDB' },
        ]);
        expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
    });

    it('reports a failed movie when DynamoDB cannot upsert it', async () => {
        ddbMock.on(UpdateCommand).rejects(new Error('Write failed'));

        const result = await invoke(JSON.stringify({ movieIds: [123] }));

        expect(result.statusCode).toBe(200);
        expect(responseBody(result).failed).toEqual([
            { id: '123', status: 'FAILED', error: 'Write failed' },
        ]);
    });

    it('retries TMDB server failures before succeeding', async () => {
        fetchMock
            .mockResolvedValueOnce(
                tmdbResponse({}, 503, {
                    'Content-Type': 'application/json',
                    'retry-after': '0',
                })
            )
            .mockResolvedValueOnce(tmdbResponse(tmdbMovie(234)));
        ddbMock.on(UpdateCommand).resolves({});

        const result = await invoke(JSON.stringify({ movieIds: [234] }));

        expect(result.statusCode).toBe(200);
        expect(responseBody(result).successful).toEqual([
            { id: '234', status: 'SUCCESS', title: 'Movie 234' },
        ]);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('reports an error after retry attempts are exhausted', async () => {
        fetchMock.mockResolvedValue(
            tmdbResponse({}, 429, {
                'Content-Type': 'application/json',
                'retry-after': '0',
            })
        );

        const result = await invoke(JSON.stringify({ movieIds: [345] }));

        expect(responseBody(result).failed).toEqual([
            { id: '345', status: 'FAILED', error: 'TMDB 429' },
        ]);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('reports unexpected TMDB statuses and timeouts as movie failures', async () => {
        fetchMock.mockResolvedValueOnce(tmdbResponse({}, 401));
        const unauthorized = await invoke(JSON.stringify({ movieIds: [456] }));
        expect(responseBody(unauthorized).failed).toEqual([
            {
                id: '456',
                status: 'FAILED',
                error: 'TMDB responded with status 401',
            },
        ]);

        fetchMock.mockRejectedValue(
            Object.assign(new Error('request aborted'), { name: 'AbortError' })
        );
        const timedOut = await invoke(JSON.stringify({ movieIds: [567] }));
        expect(responseBody(timedOut).failed).toEqual([
            { id: '567', status: 'FAILED', error: 'TMDB request timed out' },
        ]);
    });

    it('returns a 500 when an unexpected handler error occurs', async () => {
        jest.spyOn(console, 'log').mockImplementationOnce(() => {
            throw new Error('log failure');
        });

        const result = await invoke(undefined);

        expect(result.statusCode).toBe(500);
        expect(responseBody(result)).toMatchObject({
            message: 'Internal server error processing batch import.',
            error: 'log failure',
        });
    });

    it('returns configuration errors when required environment values are absent', async () => {
        const missingTableHandler = loadHandlerWithEnvironment({ TABLE_NAME: undefined });
        const missingTable = structuredResult(await missingTableHandler(createEvent('{}')));
        expect(responseBody(missingTable)).toEqual({
            message: 'TABLE_NAME is not configured.',
        });

        const missingTokenHandler = loadHandlerWithEnvironment({ TMDB_API_KEY: undefined });
        const missingToken = structuredResult(await missingTokenHandler(createEvent('{}')));
        expect(responseBody(missingToken)).toEqual({
            message: 'TMDB_API_KEY is not configured.',
        });
    });
});
