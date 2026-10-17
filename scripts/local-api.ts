import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type {
    APIGatewayProxyEventV2,
    APIGatewayProxyResultV2,
} from 'aws-lambda';

const localEndpoint = 'http://127.0.0.1:8000';
const adminToken = process.env.LOCAL_ADMIN_TOKEN ?? 'local-dev-token';
const port = Number(process.env.LOCAL_API_PORT ?? '3000');
const cloudDatabaseMode = process.argv.includes('--cloud-db');
const maxBodyBytes = 1024 * 1024;
const allowedOrigins = new Set([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4173',
    'http://127.0.0.1:4173',
]);

function requireCloudTestTable(environmentVariable: string): string {
    const tableName = process.env[environmentVariable]?.trim();
    if (!tableName) {
        throw new Error(`${environmentVariable} must name an existing cloud dev/test table.`);
    }
    if (
        !/^[A-Za-z0-9_.-]{3,255}$/.test(tableName) ||
        !/-(dev|development|test|testing|staging|sandbox)$/i.test(tableName)
    ) {
        throw new Error(
            `${environmentVariable} must be a valid DynamoDB table name ending in -dev, -development, -test, -testing, -staging, or -sandbox.`
        );
    }
    return tableName;
}

process.env.LOCAL_API = 'true';
process.env.AWS_REGION ||= 'eu-west-2';

if (cloudDatabaseMode) {
    process.env.LOCAL_API_DATABASE = 'cloud';
    delete process.env.DYNAMODB_ENDPOINT;
    process.env.TABLE_NAME = requireCloudTestTable('LOCAL_CLOUD_TABLE_NAME');
    process.env.PRICING_TABLE_NAME = requireCloudTestTable(
        'LOCAL_CLOUD_PRICING_TABLE_NAME'
    );
    process.env.OFFERS_TABLE_NAME = requireCloudTestTable(
        'LOCAL_CLOUD_OFFERS_TABLE_NAME'
    );
    process.env.COLLECTIONS_TABLE_NAME = requireCloudTestTable(
        'LOCAL_CLOUD_COLLECTIONS_TABLE_NAME'
    );
} else {
    process.env.LOCAL_API_DATABASE = 'local';
    process.env.DYNAMODB_ENDPOINT = localEndpoint;
    process.env.TABLE_NAME = 'blockbuster-theatre-movie-catalogue-local';
    process.env.PRICING_TABLE_NAME = 'blockbuster-theatre-ticket-pricing-local';
    process.env.OFFERS_TABLE_NAME = 'blockbuster-theatre-booking-offers-local';
    process.env.COLLECTIONS_TABLE_NAME = 'blockbuster-theatre-movie-collections-local';
}

type LocalHandler = (
    event: APIGatewayProxyEventV2
) => Promise<APIGatewayProxyResultV2>;

function loadHandler(path: string): LocalHandler {
    return (require(path) as { handler: LocalHandler }).handler;
}

const handlers = {
    listMovies: loadHandler('../src/main/lambda/handlers/list-movies-handler'),
    getMovie: loadHandler('../src/main/lambda/handlers/get-movie-handler'),
    listFilmSelections: loadHandler('../src/main/lambda/handlers/list-film-selections-handler'),
    getTicketPricing: loadHandler('../src/main/lambda/handlers/get-ticket-pricing-handler'),
    validateCheckout: loadHandler('../src/main/lambda/handlers/validate-checkout-handler'),
    upsertTicketPricing: loadHandler('../src/main/lambda/handlers/upsert-ticket-pricing-handler'),
    upsertBookingOffers: loadHandler('../src/main/lambda/handlers/upsert-booking-offers-handler'),
    listMovieCollections: loadHandler('../src/main/lambda/handlers/list-movie-collections-handler'),
    getMovieCollection: loadHandler('../src/main/lambda/handlers/get-movie-collection-handler'),
    refreshMovieCollection: loadHandler('../src/main/lambda/handlers/refresh-movie-collection-handler'),
};

function corsHeaders(origin: string | undefined): Record<string, string> {
    const headers: Record<string, string> = {
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    };
    if (origin && allowedOrigins.has(origin)) {
        headers['Access-Control-Allow-Origin'] = origin;
    }
    return headers;
}

function sendJson(
    response: ServerResponse,
    statusCode: number,
    body: unknown,
    origin?: string
): void {
    response.writeHead(statusCode, {
        'Content-Type': 'application/json',
        ...corsHeaders(origin),
    });
    response.end(JSON.stringify(body));
}

function readBody(request: IncomingMessage): Promise<string | undefined> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let exceededLimit = false;

        request.on('data', (chunk: Buffer | string) => {
            if (exceededLimit) return;
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += buffer.byteLength;
            if (size > maxBodyBytes) {
                exceededLimit = true;
                reject(new Error('Request body exceeds the 1 MiB local limit.'));
                return;
            }
            chunks.push(buffer);
        });
        request.on('end', () => {
            if (!exceededLimit) {
                resolve(size === 0 ? undefined : Buffer.concat(chunks).toString('utf8'));
            }
        });
        request.on('error', reject);
    });
}

function routeRequest(
    method: string,
    pathname: string
): { handler: LocalHandler; pathParameters?: Record<string, string>; requiresLocalToken?: boolean } | undefined {
    if (method === 'GET' && pathname === '/movies') {
        return { handler: handlers.listMovies };
    }
    if (method === 'GET' && pathname === '/film-selections') {
        return { handler: handlers.listFilmSelections };
    }
    if (method === 'GET' && pathname === '/collections') {
        return { handler: handlers.listMovieCollections };
    }
    if (method === 'GET' && pathname === '/ticket-pricing') {
        return { handler: handlers.getTicketPricing };
    }
    if (method === 'POST' && pathname === '/ticket-pricing') {
        return { handler: handlers.upsertTicketPricing, requiresLocalToken: true };
    }
    if (method === 'POST' && pathname === '/booking-offers') {
        return { handler: handlers.upsertBookingOffers, requiresLocalToken: true };
    }
    if (method === 'POST' && pathname === '/checkout/validate') {
        return { handler: handlers.validateCheckout };
    }

    const movieMatch = method === 'GET' ? /^\/movies\/(\d+)$/.exec(pathname) : null;
    if (movieMatch) {
        return {
            handler: handlers.getMovie,
            pathParameters: { id: movieMatch[1] },
        };
    }
    if (method === 'POST' && pathname === '/collections/refresh') {
        return {
            handler: handlers.refreshMovieCollection,
            requiresLocalToken: true,
        };
    }
    const collectionMatch = method === 'GET' ? /^\/collections\/(\d+)$/.exec(pathname) : null;
    if (collectionMatch) {
        return {
            handler: handlers.getMovieCollection,
            pathParameters: { id: collectionMatch[1] },
        };
    }
    return undefined;
}

async function handleRequest(
    request: IncomingMessage,
    response: ServerResponse
): Promise<void> {
    const origin = typeof request.headers.origin === 'string'
        ? request.headers.origin
        : undefined;

    if (request.method === 'OPTIONS') {
        response.writeHead(204, corsHeaders(origin));
        response.end();
        return;
    }

    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname === '/health') {
        sendJson(response, 200, { status: 'ok' }, origin);
        return;
    }

    const route = routeRequest(request.method ?? 'GET', url.pathname);
    if (!route) {
        sendJson(response, 404, { message: 'Local API route not found.' }, origin);
        return;
    }

    if (route.requiresLocalToken) {
        const expected = `Bearer ${adminToken}`;
        if (request.headers.authorization !== expected) {
            sendJson(response, 401, { message: 'A valid local admin token is required.' }, origin);
            return;
        }
    }

    let body: string | undefined;
    try {
        body = await readBody(request);
    } catch (error: unknown) {
        sendJson(
            response,
            413,
            { message: error instanceof Error ? error.message : 'Request body is too large.' },
            origin
        );
        return;
    }

    const headers = Object.fromEntries(
        Object.entries(request.headers).flatMap(([key, value]) => (
            typeof value === 'string' ? [[key, value]] : []
        ))
    );
    const event = {
        version: '2.0',
        routeKey: `${request.method} ${url.pathname}`,
        rawPath: url.pathname,
        rawQueryString: url.search.slice(1),
        headers,
        queryStringParameters: Object.fromEntries(url.searchParams.entries()),
        pathParameters: route.pathParameters,
        body,
        isBase64Encoded: false,
        requestContext: {
            requestId: randomUUID(),
            http: {
                method: request.method ?? 'GET',
                path: url.pathname,
                protocol: 'HTTP/1.1',
                sourceIp: '127.0.0.1',
                userAgent: request.headers['user-agent'] ?? 'local-api',
            },
        },
    } as unknown as APIGatewayProxyEventV2;

    try {
        const result = await route.handler(event);
        if (typeof result === 'string') {
            response.writeHead(200, {
                'Content-Type': 'text/plain',
                ...corsHeaders(origin),
            });
            response.end(result);
            return;
        }

        const handlerHeaders: Record<string, string> = {};
        for (const [name, value] of Object.entries(result.headers ?? {})) {
            if (value !== undefined) handlerHeaders[name] = String(value);
        }
        response.writeHead(result.statusCode ?? 200, {
            ...handlerHeaders,
            ...corsHeaders(origin),
        });
        response.end(result.body ?? '');
    } catch (error: unknown) {
        console.error('Local API handler failed:', error);
        sendJson(response, 500, { message: 'Local API handler failed.' }, origin);
    }
}

if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('LOCAL_API_PORT must be a valid TCP port.');
}

const server = createServer((request, response) => {
    void handleRequest(request, response);
});

server.listen(port, '127.0.0.1', () => {
    console.log(`Local API listening at http://127.0.0.1:${port}`);
    if (cloudDatabaseMode) {
        console.log(`AWS region: ${process.env.AWS_REGION}`);
        console.log(`Cloud dev/test tables: ${process.env.TABLE_NAME}, ${process.env.PRICING_TABLE_NAME}, ${process.env.OFFERS_TABLE_NAME}, ${process.env.COLLECTIONS_TABLE_NAME}`);
    } else {
        console.log(`DynamoDB Local endpoint: ${localEndpoint}`);
    }
    console.log(`Local admin token: ${adminToken}`);
    console.log('This local server bypasses the deployed API Gateway JWT authorizer.');
});
