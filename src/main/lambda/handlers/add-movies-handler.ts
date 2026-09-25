import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: {removeUndefinedValues: true},
});

function intEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`Invalid env var ${name}=${raw}`);
    }
    return n;
}

const TABLE_NAME = process.env.TABLE_NAME ?? '';
const TMDB_TOKEN = process.env.TMDB_API_KEY ?? '';
const MAX_BATCH = intEnv('MAX_BATCH', 25);
const CONCURRENCY = intEnv('TMDB_CONCURRENCY', 5);
const TMDB_TIMEOUT_MS = intEnv('TMDB_TIMEOUT_MS', 4000);
const TMDB_RETRIES = intEnv('TMDB_RETRIES', 3);

interface ProcessResult {
    id: string;
    status: 'SUCCESS' | 'FAILED';
    title?: string;
    error?: string;
}

const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'OPTIONS,POST',
};

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
    return {statusCode, headers, body: JSON.stringify(body)};
}

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

async function mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;

    async function worker() {
        while (true) {
            const i = next++;
            if (i >= items.length) return;
            results[i] = await fn(items[i]);
        }
    }

    await Promise.all(Array.from({length: Math.min(limit, items.length)}, worker));
    return results;
}

function projectTmdb(raw: any) {
    return {
        id: raw.id,
        title: raw.title,
        originalTitle: raw.original_title,
        overview: raw.overview,
        releaseDate: raw.release_date,
        runtime: raw.runtime,
        posterPath: raw.poster_path,
        backdropPath: raw.backdrop_path,
        voteAverage: raw.vote_average,
        voteCount: raw.vote_count,
        popularity: raw.popularity,
        genres: raw.genres,
        originalLanguage: raw.original_language,
        imdbId: raw.imdb_id,
        status: raw.status,
    };
}

async function fetchTmdbMovie(id: string): Promise<any> {
    const url = `https://api.themoviedb.org/3/movie/${id}`;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < TMDB_RETRIES; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TMDB_TIMEOUT_MS);

        try {
            const res = await fetch(url, {
                headers: {Authorization: `Bearer ${TMDB_TOKEN}`, Accept: 'application/json'},
                signal: controller.signal,
            });

            if (res.status === 404) {
                throw new Error('Movie not found on TMDB');
            }

            if (res.status === 429 || res.status >= 500) {
                const retryAfter = Number(res.headers.get('retry-after'));
                const delay = Number.isFinite(retryAfter) ? retryAfter * 1000 : 200 * 2 ** attempt;
                await sleep(delay);
                lastError = new Error(`TMDB ${res.status}`);
                continue;
            }

            if (!res.ok) {
                throw new Error(`TMDB responded with status ${res.status}`);
            }

            return await res.json();
        } catch (err: unknown) {
            if (err instanceof Error && err.name === 'AbortError') {
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

async function upsertMovie(id: string, tmdbData: ReturnType<typeof projectTmdb>) {
    const title = tmdbData.title || 'Untitled';

    await docClient.send(
        new UpdateCommand({
            TableName: TABLE_NAME,
            Key: {
                PK: `MOVIE#${id}`,
                SK: 'METADATA',
            },
            UpdateExpression: `
            SET tmdbData = :tmdbData,
                title = :title,
                tmdbId = :tmdbId,
                entityType = :entityType,
                lastUpdated = :lastUpdated,
                GSI1PK = :gsi1pk,
                GSI1SK = :gsi1sk,
                isVisible = if_not_exists(isVisible, :defaultVisible),
                isCarousel = if_not_exists(isCarousel, :defaultCarousel)
      `,
            ExpressionAttributeValues: {
                ':tmdbData': tmdbData,
                ':title': title,
                ':tmdbId': id,
                ':entityType': 'Movie',
                ':lastUpdated': new Date().toISOString(),
                ':gsi1pk': 'MOVIE',
                ':gsi1sk': `${tmdbData.releaseDate || '0000-00-00'}#${id}`,
                ':defaultVisible': true,
                ':defaultCarousel': false,
            },
        })
    );
}

export const handler = async (
    event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
    try {
        if (!TABLE_NAME) {
            return json(500, {message: 'TABLE_NAME is not configured.'});
        }

        if (!TMDB_TOKEN) {
            return json(500, {message: 'TMDB_API_KEY is not configured.'});
        }

        if (!event.body) {
            return json(400, {message: 'Missing request body.'});
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(event.body);
        } catch {
            return json(400, {message: 'Request body is not valid JSON.'});
        }

        const movieIds = (parsed as { movieIds?: unknown }).movieIds;
        if (!Array.isArray(movieIds) || movieIds.length === 0) {
            return json(400, {message: 'movieIds must be a non-empty array.'});
        }

        if (movieIds.length > MAX_BATCH) {
            return json(400, {
                message: `movieIds cannot exceed ${MAX_BATCH} items per request.`,
            });
        }

        const ids = [
            ...new Set(movieIds.map((raw) => String(raw).trim()).filter(Boolean)),
        ];

        const invalid = ids.filter((id) => !/^\d+$/.test(id));
        if (invalid.length) {
            return json(400, {
                message: 'All movieIds must be numeric TMDB IDs.',
                invalid,
            });
        }

        const results: ProcessResult[] = await mapWithConcurrency(
            ids,
            CONCURRENCY,
            async (id) => {
                try {
                    const raw = await fetchTmdbMovie(id);
                    const tmdbData = projectTmdb(raw);
                    await upsertMovie(id, tmdbData);
                    return {id, status: 'SUCCESS', title: tmdbData.title};
                } catch (err: unknown) {
                    const message =
                        err instanceof Error ? err.message : 'Failed to process movie ID';
                    return {id, status: 'FAILED', error: message};
                }
            }
        );

        const successful = results.filter((r) => r.status === 'SUCCESS');
        const failed = results.filter((r) => r.status === 'FAILED');

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
        console.error('Unhandled Lambda Error:', error);
        return json(500, {
            message: 'Internal server error processing batch import.',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
};