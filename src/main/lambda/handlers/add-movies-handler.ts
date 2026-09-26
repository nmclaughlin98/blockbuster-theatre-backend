import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { ProcessResult, TmdbMovieResponse } from './interfaces';
import {
    intEnv,
    isTmdbMovieResponse,
    json,
    log,
    mapWithConcurrency,
    normalizeMovieIds,
    projectTmdb,
    sleep,
} from './utils';

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
});

const TABLE_NAME = process.env.TABLE_NAME ?? '';
const TMDB_TOKEN = process.env.TMDB_API_KEY ?? '';
const MAX_BATCH = intEnv('MAX_BATCH', 25);
const CONCURRENCY = intEnv('TMDB_CONCURRENCY', 5);
const TMDB_TIMEOUT_MS = intEnv('TMDB_TIMEOUT_MS', 4000);
const TMDB_RETRIES = intEnv('TMDB_RETRIES', 3);

async function fetchTmdbMovie(id: string): Promise<TmdbMovieResponse> {
    const params = new URLSearchParams({
        append_to_response: 'credits,videos,release_dates',
    });
    const url = `https://api.themoviedb.org/3/movie/${id}?${params}`;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < TMDB_RETRIES; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TMDB_TIMEOUT_MS);

        log('INFO', 'Fetching movie from TMDB', {
            id,
            attempt: attempt + 1,
            maxAttempts: TMDB_RETRIES,
        });

        try {
            const res = await fetch(url, {
                headers: {
                    Authorization: `Bearer ${TMDB_TOKEN}`,
                    Accept: 'application/json',
                },
                signal: controller.signal,
            });

            if (res.status === 404) {
                log('WARN', 'Movie not found on TMDB', { id, attempt: attempt + 1 });
                throw new Error('Movie not found on TMDB');
            }

            if (res.status === 429 || res.status >= 500) {
                const retryAfterHeader = res.headers.get('retry-after');
                const retryAfter = Number(retryAfterHeader);
                const delay = retryAfterHeader && Number.isFinite(retryAfter)
                    ? retryAfter * 1000
                    : 200 * 2 ** attempt;
                log('WARN', 'TMDB request failed, retrying', {
                    id,
                    attempt: attempt + 1,
                    status: res.status,
                    delayMs: delay,
                });
                await sleep(delay);
                lastError = new Error(`TMDB ${res.status}`);
                continue;
            }

            if (!res.ok) {
                log('ERROR', 'TMDB responded with an unexpected status', { id, status: res.status });
                throw new Error(`TMDB responded with status ${res.status}`);
            }

            const body: unknown = await res.json();
            if (!isTmdbMovieResponse(body)) {
                throw new Error('TMDB returned an invalid movie response');
            }
            return body;
        } catch (err: unknown) {
            if (err instanceof Error && err.name === 'AbortError') {
                log('WARN', 'TMDB request timed out', {
                    id,
                    attempt: attempt + 1,
                    timeoutMs: TMDB_TIMEOUT_MS,
                });
                lastError = new Error('TMDB request timed out');
                continue;
            }
            throw err;
        } finally {
            clearTimeout(timer);
        }
    }

    throw lastError ?? new Error('TMDB request failed');
}

async function upsertMovie(id: string, movieData: ReturnType<typeof projectTmdb>) {
    log('INFO', 'Upserting movie into DynamoDB', { id, title: movieData.title });

    await docClient.send(
        new UpdateCommand({
            TableName: TABLE_NAME,
            Key: {
                tmdbId: `${id}`,
            },
            UpdateExpression: `
            SET slug = :slug,
                title = :title,
                genres = :genres,
                rating = :rating,
                score = :score,
                runtime = :runtime,
                releaseDate = :releaseDate,
                visible = :visible,
                starring = :starring,
                director = :director,
                synopsis = :synopsis,
                still = :still,
                trailer = :trailer,
                poster = :poster,
                showtimes = :showtimes,
                entityType = :entityType,
                lastUpdated = :lastUpdated,
                GSI1PK = :gsi1pk,
                GSI1SK = :gsi1sk,
                isCarousel = if_not_exists(isCarousel, :defaultCarousel)
            `,
            ExpressionAttributeValues: {
                ':slug': movieData.slug,
                ':title': movieData.title,
                ':genres': movieData.genres,
                ':rating': movieData.rating,
                ':score': movieData.score,
                ':runtime': movieData.runtime,
                ':releaseDate': movieData.releaseDate,
                ':visible': movieData.visible,
                ':starring': movieData.starring,
                ':director': movieData.director,
                ':synopsis': movieData.synopsis,
                ':still': movieData.still,
                ':trailer': movieData.trailer,
                ':poster': movieData.poster,
                ':showtimes': movieData.showtimes,
                ':entityType': 'Movie',
                ':lastUpdated': new Date().toISOString(),
                ':gsi1pk': 'MOVIE',
                ':gsi1sk': `${movieData.releaseDate || '0000-00-00'}#${id}`,
                ':defaultCarousel': false,
            },
        })
    );
}

export const handler = async (
    event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
    const requestId = event.requestContext?.requestId;

    try {
        log('INFO', 'Received add-movies request', { requestId });

        if (!TABLE_NAME) {
            log('ERROR', 'TABLE_NAME is not configured', { requestId });
            return json(500, { message: 'TABLE_NAME is not configured.' });
        }

        if (!TMDB_TOKEN) {
            log('ERROR', 'TMDB_API_KEY is not configured', { requestId });
            return json(500, { message: 'TMDB_API_KEY is not configured.' });
        }

        if (!event.body) {
            log('WARN', 'Request rejected: missing body', { requestId });
            return json(400, { message: 'Missing request body.' });
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(event.body);
        } catch {
            log('WARN', 'Request rejected: invalid JSON body', { requestId });
            return json(400, { message: 'Request body is not valid JSON.' });
        }

        const movieIds =
            parsed !== null && typeof parsed === 'object'
                ? (parsed as { movieIds?: unknown }).movieIds
                : undefined;
        if (!Array.isArray(movieIds) || movieIds.length === 0) {
            log('WARN', 'Request rejected: movieIds must be a non-empty array', { requestId });
            return json(400, { message: 'movieIds must be a non-empty array.' });
        }

        if (movieIds.length > MAX_BATCH) {
            log('WARN', 'Request rejected: batch size exceeds limit', {
                requestId,
                requestedCount: movieIds.length,
                maxBatch: MAX_BATCH,
            });
            return json(400, {
                message: `movieIds cannot exceed ${MAX_BATCH} items per request.`,
            });
        }

        const { ids, invalid } = normalizeMovieIds(movieIds);
        if (invalid.length) {
            log('WARN', 'Request rejected: non-numeric movie IDs supplied', { requestId, invalid });
            return json(400, {
                message: 'All movieIds must be numeric TMDB IDs.',
                invalid,
            });
        }

        log('INFO', 'Processing movie batch', {
            requestId,
            count: ids.length,
            dedupedFrom: movieIds.length,
            concurrency: CONCURRENCY,
        });

        const results: ProcessResult[] = await mapWithConcurrency(
            ids,
            CONCURRENCY,
            async (id) => {
                try {
                    const raw = await fetchTmdbMovie(id);
                    const movieData = projectTmdb(raw);
                    await upsertMovie(id, movieData);
                    log('INFO', 'Movie processed successfully', {
                        requestId,
                        id,
                        title: movieData.title,
                    });
                    return { id, status: 'SUCCESS', title: movieData.title };
                } catch (err: unknown) {
                    const message =
                        err instanceof Error ? err.message : 'Failed to process movie ID';
                    log('ERROR', 'Movie processing failed', { requestId, id, error: message });
                    return { id, status: 'FAILED', error: message };
                }
            }
        );

        const successful = results.filter((result) => result.status === 'SUCCESS');
        const failed = results.filter((result) => result.status === 'FAILED');

        log('INFO', 'Batch processing complete', {
            requestId,
            total: ids.length,
            successCount: successful.length,
            failedCount: failed.length,
        });

        return json(200, {
            message: `Processed ${ids.length} movie(s).`,
            summary: {
                total: ids.length,
                successCount: successful.length,
                failedCount: failed.length,
                dedupedFrom: movieIds.length,
            },
            successful,
            failed,
        });
    } catch (error: unknown) {
        log('ERROR', 'Unhandled Lambda error', {
            requestId,
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
        });
        return json(500, {
            message: 'Internal server error processing batch import.',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
};
