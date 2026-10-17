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
import { intEnv, json, log, sleep } from './utils/common';

const docClient = DynamoDBDocumentClient.from(createDynamoDBClient());
const COLLECTIONS_TABLE_NAME = process.env.COLLECTIONS_TABLE_NAME ?? '';
const TMDB_TOKEN = process.env.TMDB_API_KEY ?? '';
const TMDB_TIMEOUT_MS = intEnv('TMDB_TIMEOUT_MS', 4000);
const TMDB_RETRIES = intEnv('TMDB_RETRIES', 3);

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

export const handler = async (
    event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
    const requestId = event.requestContext?.requestId;
    const rawListId = event.pathParameters?.id;

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
    if (!rawListId ||
        !/^\d+$/.test(rawListId) ||
        !Number.isSafeInteger(Number(rawListId)) ||
        Number(rawListId) <= 0
    ) {
        return json(400, { message: 'A numeric TMDB list ID is required.' });
    }
    const listId = String(Number(rawListId));

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
        return json(200, {
            message: 'TMDB list refreshed successfully.',
            collectionId: listId,
            name: collection.name,
            movieCount: movieIds.length,
            lastUpdated: collection.lastUpdated,
        });
    } catch (error: unknown) {
        const statusCode = error instanceof TmdbListError
            ? error.statusCode
            : 500;
        log('ERROR', 'Failed to refresh TMDB list', {
            requestId,
            listId,
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        return json(statusCode, {
            message: statusCode === 404
                ? 'TMDB list not found.'
                : statusCode === 502
                    ? 'Unable to retrieve the TMDB list.'
                    : 'Unable to refresh the collection.',
        });
    }
};
