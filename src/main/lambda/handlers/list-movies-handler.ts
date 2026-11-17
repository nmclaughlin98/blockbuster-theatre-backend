import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
    DynamoDBDocumentClient,
    QueryCommand,
    type NativeAttributeValue,
} from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from './dynamodb-client';
import { json, log } from './utils/common';
import type { MovieSummary } from './interfaces';
import { projectMovieSummary } from './utils/movie-projection';
import { isMovieRecord } from './utils/movie-validation';
import { ShowtimeIdError } from './utils/showtime-ids';

const docClient = DynamoDBDocumentClient.from(createDynamoDBClient());
const TABLE_NAME = process.env.TABLE_NAME ?? '';
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 100;
const MAX_QUERY_PAGES = 20;
// Includes the JSON-escaped API Gateway proxy envelope, not just the HTTP body.
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

type MovieCursor = {
    tmdbId: string;
    slug: string;
    GSI1PK: string;
    GSI1SK: string;
};

/** Checks that a decoded pagination cursor contains all required index keys. */
function isMovieCursor(value: unknown): value is MovieCursor {
    return (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        'tmdbId' in value &&
        typeof value.tmdbId === 'string' &&
        'slug' in value &&
        typeof value.slug === 'string' &&
        'GSI1PK' in value &&
        typeof value.GSI1PK === 'string' &&
        'GSI1SK' in value &&
        typeof value.GSI1SK === 'string'
    );
}

/**
 * Parses the optional page-size query parameter.
 * @param value Raw `limit` query parameter.
 * @returns A page size between 1 and the configured maximum.
 * @throws If the value is not a valid page size.
 */
function parsePageSize(value: string | undefined): number {
    if (value === undefined) return DEFAULT_PAGE_SIZE;

    const pageSize = Number(value);
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
        throw new Error(`limit must be an integer between 1 and ${MAX_PAGE_SIZE}.`);
    }
    return pageSize;
}

/**
 * Decodes and validates a continuation token for a DynamoDB query.
 * @param value Base64url-encoded last-evaluated key.
 * @returns DynamoDB exclusive start key, or undefined for the first page.
 * @throws If the token is malformed.
 */
function parseNextToken(value: string | undefined): Record<string, NativeAttributeValue> | undefined {
    if (value === undefined) return undefined;

    let parsed: unknown;
    try {
        parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    } catch {
        throw new Error('nextToken is invalid.');
    }

    if (!isMovieCursor(parsed)) {
        throw new Error('nextToken is invalid.');
    }

    return {
        tmdbId: parsed.tmdbId,
        slug: parsed.slug,
        GSI1PK: parsed.GSI1PK,
        GSI1SK: parsed.GSI1SK,
    };
}

function encodeNextToken(key: Record<string, NativeAttributeValue> | undefined): string | null {
    return key && Object.keys(key).length
        ? Buffer.from(JSON.stringify(key)).toString('base64url')
        : null;
}

function responseSize(movies: MovieSummary[], nextToken: string | null): number {
    return Buffer.byteLength(JSON.stringify(json(200, { movies, nextToken })), 'utf8');
}

/**
 * Returns a paginated list of movie summaries, ordered by release date.
 * @param event API Gateway request with optional `limit` and `nextToken` query parameters.
 * @returns A page of summaries and its continuation token.
 */
export const handler = async (
    event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
    const requestId = event.requestContext?.requestId;

    if (!TABLE_NAME) {
        log('ERROR', 'TABLE_NAME is not configured', { requestId });
        return json(500, { message: 'TABLE_NAME is not configured.' });
    }

    let limit: number;
    let exclusiveStartKey: Record<string, NativeAttributeValue> | undefined;
    try {
        limit = parsePageSize(event.queryStringParameters?.limit);
        exclusiveStartKey = parseNextToken(event.queryStringParameters?.nextToken);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Invalid pagination parameters.';
        return json(400, { message });
    }

    try {
        let movies: MovieSummary[] = [];
        for (let page = 0; page < MAX_QUERY_PAGES; page++) {
            const result = await docClient.send(
                new QueryCommand({
                    TableName: TABLE_NAME,
                    IndexName: 'GSI1',
                    KeyConditionExpression: 'GSI1PK = :movie',
                    ExpressionAttributeValues: {
                        ':movie': 'MOVIE',
                    },
                    Limit: limit,
                    ScanIndexForward: false,
                    ExclusiveStartKey: exclusiveStartKey,
                })
            );

            const visibleItems = (result.Items ?? []).filter((item) => item.visible !== false);
            const pageMovies = visibleItems.map((item) => {
                // Legacy records without visible remain public; preserve the summary's boolean shape.
                const normalized = item.visible === undefined ? { ...item, visible: true } : item;
                if (!isMovieRecord(normalized)) {
                    throw new Error('DynamoDB returned an invalid movie record.');
                }
                return projectMovieSummary(normalized);
            });
            const nextToken = encodeNextToken(result.LastEvaluatedKey);
            const combined = [...movies, ...pageMovies];

            if (responseSize(combined, nextToken) > MAX_RESPONSE_BYTES) {
                if (page > 0) {
                    return json(200, { movies, nextToken: encodeNextToken(exclusiveStartKey) });
                }

                // A single DynamoDB page can expand when JSON is escaped in the proxy response.
                for (let i = 0; i < pageMovies.length; i++) {
                    const item = visibleItems[i];
                    if (!isMovieCursor(item)) {
                        throw new Error('DynamoDB returned a movie without pagination keys.');
                    }
                    const cursor = {
                        tmdbId: item.tmdbId,
                        slug: item.slug,
                        GSI1PK: item.GSI1PK,
                        GSI1SK: item.GSI1SK,
                    };
                    const candidate = [...movies, pageMovies[i]];
                    if (responseSize(candidate, encodeNextToken(cursor)) > MAX_RESPONSE_BYTES) {
                        if (!movies.length) {
                            throw new Error('A movie exceeds the response size budget.');
                        }
                        const previous = visibleItems[i - 1];
                        if (!isMovieCursor(previous)) {
                            throw new Error('DynamoDB returned a movie without pagination keys.');
                        }
                        return json(200, {
                            movies,
                            nextToken: encodeNextToken({
                                tmdbId: previous.tmdbId,
                                slug: previous.slug,
                                GSI1PK: previous.GSI1PK,
                                GSI1SK: previous.GSI1SK,
                            }),
                        });
                    }
                    movies = candidate;
                }
                const last = visibleItems[visibleItems.length - 1];
                if (!isMovieCursor(last)) {
                    throw new Error('DynamoDB returned a movie without pagination keys.');
                }
                return json(200, {
                    movies,
                    nextToken: encodeNextToken({
                        tmdbId: last.tmdbId,
                        slug: last.slug,
                        GSI1PK: last.GSI1PK,
                        GSI1SK: last.GSI1SK,
                    }),
                });
            }

            movies = combined;
            if (!nextToken || event.queryStringParameters?.limit !== undefined || page === MAX_QUERY_PAGES - 1) {
                return json(200, { movies, nextToken });
            }
            exclusiveStartKey = result.LastEvaluatedKey;
        }
        throw new Error('Unable to complete movie pagination.');
    } catch (error: unknown) {
        if (error instanceof ShowtimeIdError) {
            return json(error.statusCode, { message: error.message });
        }
        log('ERROR', 'Failed to retrieve movies', {
            requestId,
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        return json(500, { message: 'Unable to retrieve movies.' });
    }
};
