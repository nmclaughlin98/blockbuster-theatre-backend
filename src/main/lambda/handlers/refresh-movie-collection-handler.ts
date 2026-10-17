import type {
    APIGatewayProxyEventV2,
    APIGatewayProxyResultV2,
} from 'aws-lambda';
import {
    DynamoDBDocumentClient,
    PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from './dynamodb-client';
import type { MovieCollectionRecord } from './interfaces';
import {
    intEnv,
    json,
    log,
    mapWithConcurrency,
    sleep,
} from './utils/common';

const docClient = DynamoDBDocumentClient.from(createDynamoDBClient());
const COLLECTIONS_TABLE_NAME = process.env.COLLECTIONS_TABLE_NAME ?? '';
const TMDB_TOKEN = process.env.TMDB_API_KEY ?? '';
const TMDB_TIMEOUT_MS = intEnv('TMDB_TIMEOUT_MS', 4000);
const TMDB_RETRIES = intEnv('TMDB_RETRIES', 3);
const MAX_COLLECTIONS_PER_REFRESH = 25;
const REFRESH_CONCURRENCY = 5;

type RefreshResult =
    | {
        collectionId: string;
        success: true;
        name: string;
        movieCount: number;
        lastUpdated: string;
    }
    | {
        collectionId: string;
        success: false;
        statusCode: number;
        message: string;
    };

interface TmdbListItem {
    id: number;
    media_type?: string;
}

interface TmdbListResponse {
    id: number;
    name: string;
    description?: string | null;
    poster_path?: string | null;
    backdrop_path?: string | null;
    page: number;
    total_pages: number;
    items: TmdbListItem[];
}

class TmdbListError extends Error {
    constructor(message: string, readonly statusCode: number) {
        super(message);
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseCollectionIds(event: APIGatewayProxyEventV2):
    | { ids: string[] }
    | { error: string; invalidIndexes?: number[]; duplicateIds?: string[] } {
    if (!event.body) {
        return { error: 'Missing request body.' };
    }

    let body: unknown;
    try {
        const content = event.isBase64Encoded
            ? Buffer.from(event.body, 'base64').toString('utf8')
            : event.body;
        body = JSON.parse(content);
    } catch {
        return { error: 'Request body is not valid JSON.' };
    }

    const ids = isRecord(body) ? body.ids : undefined;
    if (!Array.isArray(ids) || ids.length === 0) {
        return { error: 'ids must be a non-empty array.' };
    }
    if (ids.length > MAX_COLLECTIONS_PER_REFRESH) {
        return {
            error: `ids cannot exceed ${MAX_COLLECTIONS_PER_REFRESH} items per request.`,
        };
    }

    const normalizedIds: string[] = [];
    const invalidIndexes: number[] = [];
    const seenIds = new Set<string>();
    const duplicateIds = new Set<string>();

    ids.forEach((value, index) => {
        const rawId = typeof value === 'number' && Number.isSafeInteger(value)
            ? String(value)
            : typeof value === 'string'
                ? value
                : '';
        if (!/^\d+$/.test(rawId) || !Number.isSafeInteger(Number(rawId)) ||
            Number(rawId) <= 0
        ) {
            invalidIndexes.push(index);
            return;
        }

        const id = String(Number(rawId));
        if (seenIds.has(id)) duplicateIds.add(id);
        seenIds.add(id);
        normalizedIds.push(id);
    });

    if (invalidIndexes.length > 0) {
        return {
            error: 'Every collection ID must be a positive safe integer.',
            invalidIndexes,
        };
    }
    if (duplicateIds.size > 0) {
        return {
            error: 'Duplicate collection IDs are not allowed in one request.',
            duplicateIds: [...duplicateIds],
        };
    }

    return { ids: normalizedIds };
}

function isTmdbListItem(value: unknown): value is TmdbListItem {
    return isRecord(value) &&
        Number.isSafeInteger(value.id) &&
        typeof value.id === 'number' &&
        value.id > 0 &&
        (value.media_type === undefined || typeof value.media_type === 'string');
}

function isTmdbListResponse(value: unknown): value is TmdbListResponse {
    return isRecord(value) &&
        Number.isSafeInteger(value.id) &&
        typeof value.id === 'number' &&
        typeof value.name === 'string' &&
        (value.description === undefined ||
            value.description === null ||
            typeof value.description === 'string') &&
        (value.poster_path === undefined ||
            value.poster_path === null ||
            typeof value.poster_path === 'string') &&
        (value.backdrop_path === undefined ||
            value.backdrop_path === null ||
            typeof value.backdrop_path === 'string') &&
        Number.isSafeInteger(value.page) &&
        typeof value.page === 'number' &&
        value.page > 0 &&
        Number.isSafeInteger(value.total_pages) &&
        typeof value.total_pages === 'number' &&
        value.total_pages >= value.page &&
        Array.isArray(value.items) &&
        value.items.every(isTmdbListItem);
}

async function fetchTmdbListPage(
    listId: string,
    page: number
): Promise<TmdbListResponse> {
    const params = new URLSearchParams({
        language: 'en-US',
        page: String(page),
    });
    const url = `https://api.themoviedb.org/3/list/${listId}?${params}`;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < TMDB_RETRIES; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TMDB_TIMEOUT_MS);

        try {
            const response = await fetch(url, {
                headers: {
                    Authorization: `Bearer ${TMDB_TOKEN}`,
                    Accept: 'application/json',
                },
                signal: controller.signal,
            });

            if (response.status === 404) {
                throw new TmdbListError(`TMDB list ${listId} was not found.`, 404);
            }

            if (response.status === 429 || response.status >= 500) {
                const retryAfter = Number(response.headers.get('retry-after'));
                const delay = Number.isFinite(retryAfter) && retryAfter > 0
                    ? Math.min(retryAfter * 1000, 5000)
                    : 200 * 2 ** attempt;
                log('WARN', 'TMDB list request failed, retrying', {
                    listId,
                    page,
                    attempt: attempt + 1,
                    status: response.status,
                    delayMs: delay,
                });
                await sleep(delay);
                lastError = new TmdbListError(
                    `TMDB list request returned ${response.status}.`,
                    502
                );
                continue;
            }

            if (!response.ok) {
                throw new TmdbListError(
                    `TMDB list request returned ${response.status}.`,
                    502
                );
            }

            const body: unknown = await response.json();
            if (!isTmdbListResponse(body) ||
                String(body.id) !== listId ||
                body.page !== page
            ) {
                throw new TmdbListError('TMDB returned an invalid list response.', 502);
            }
            return body;
        } catch (error: unknown) {
            if (error instanceof TmdbListError) throw error;
            if (error instanceof Error && error.name === 'AbortError') {
                lastError = new TmdbListError('TMDB list request timed out.', 502);
                continue;
            }
            throw new TmdbListError('Unable to fetch the TMDB list.', 502);
        } finally {
            clearTimeout(timer);
        }
    }

    throw lastError ?? new TmdbListError('TMDB list request failed.', 502);
}

async function refreshList(
    listId: string,
    requestId: string | undefined
): Promise<RefreshResult> {
    try {
        const firstPage = await fetchTmdbListPage(listId, 1);
        const itemPages = [firstPage];
        for (let page = 2; page <= firstPage.total_pages; page++) {
            itemPages.push(await fetchTmdbListPage(listId, page));
        }

        const movieIds = [...new Set(
            itemPages
                .flatMap((listPage) => listPage.items)
                .filter((item) => item.media_type === undefined || item.media_type === 'movie')
                .map((item) => String(item.id))
        )];
        const collection: MovieCollectionRecord = {
            collectionId: listId,
            name: firstPage.name,
            description: firstPage.description ?? '',
            posterUrl: firstPage.poster_path
                ? `https://image.tmdb.org/t/p/w500${firstPage.poster_path}`
                : '',
            backdropUrl: firstPage.backdrop_path
                ? `https://image.tmdb.org/t/p/w1280${firstPage.backdrop_path}`
                : '',
            movieIds,
            lastUpdated: new Date().toISOString(),
        };

        await docClient.send(
            new PutCommand({
                TableName: COLLECTIONS_TABLE_NAME,
                Item: collection,
            })
        );

        log('INFO', 'TMDB list refreshed', {
            requestId,
            listId,
            pages: firstPage.total_pages,
            movieCount: movieIds.length,
        });
        return {
            collectionId: listId,
            success: true,
            name: collection.name,
            movieCount: movieIds.length,
            lastUpdated: collection.lastUpdated,
        };
    } catch (error: unknown) {
        const statusCode = error instanceof TmdbListError
            ? error.statusCode
            : 500;
        log('ERROR', 'Failed to refresh TMDB list', {
            requestId,
            listId,
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        return {
            collectionId: listId,
            success: false,
            statusCode,
            message: statusCode === 404
                ? 'TMDB list not found.'
                : statusCode === 502
                    ? 'Unable to retrieve the TMDB list.'
                    : 'Unable to refresh the collection.',
        };
    }
}

export const handler = async (
    event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
    const requestId = event.requestContext?.requestId;

    if (!COLLECTIONS_TABLE_NAME) {
        log('ERROR', 'Collection table is not configured', {
            requestId,
            collectionsTableConfigured: Boolean(COLLECTIONS_TABLE_NAME),
        });
        return json(500, { message: 'Collection data is not configured.' });
    }
    if (!TMDB_TOKEN) {
        log('ERROR', 'TMDB_API_KEY is not configured', { requestId });
        return json(500, { message: 'TMDB_API_KEY is not configured.' });
    }

    const parsedIds = parseCollectionIds(event);
    if ('error' in parsedIds) {
        return json(400, {
            message: parsedIds.error,
            ...(parsedIds.invalidIndexes && { invalidIndexes: parsedIds.invalidIndexes }),
            ...(parsedIds.duplicateIds && { duplicateIds: parsedIds.duplicateIds }),
        });
    }

    const results = await mapWithConcurrency(
        parsedIds.ids,
        REFRESH_CONCURRENCY,
        (listId) => refreshList(listId, requestId)
    );
    const failedCount = results.filter((result) => !result.success).length;

    return json(failedCount > 0 ? 207 : 200, {
        message: failedCount > 0
            ? 'One or more TMDB lists could not be refreshed.'
            : 'TMDB lists refreshed successfully.',
        refreshedCount: results.length - failedCount,
        failedCount,
        results,
    });
};
