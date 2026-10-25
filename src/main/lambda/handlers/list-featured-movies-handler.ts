import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
    DynamoDBDocumentClient,
    QueryCommand,
    type NativeAttributeValue,
} from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from './dynamodb-client';
import { json, log } from './utils/common';
import { projectMovieSummary } from './utils/movie-projection';
import { isMovieRecord } from './utils/movie-validation';

const docClient = DynamoDBDocumentClient.from(createDynamoDBClient());
const TABLE_NAME = process.env.TABLE_NAME ?? '';
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

type FeaturedMovieKind = 'newest' | 'top-picks';
type MovieCursor = Record<string, NativeAttributeValue> & {
    tmdbId: string;
    slug: string;
    GSI1PK: string;
    GSI1SK?: string;
    score?: number;
};

const movieQueries: Record<FeaturedMovieKind, {
    indexName: string;
    sortKey: 'GSI1SK' | 'score';
    filterComingSoon: boolean;
}> = {
    newest: { indexName: 'GSI1', sortKey: 'GSI1SK', filterComingSoon: true },
    'top-picks': { indexName: 'GSI2', sortKey: 'score', filterComingSoon: false },
};

function isMovieCursor(value: unknown, sortKey: MovieQueries['sortKey']): value is MovieCursor {
    if (
        typeof value !== 'object' ||
        value === null ||
        Array.isArray(value) ||
        !('tmdbId' in value) ||
        typeof value.tmdbId !== 'string' ||
        !('slug' in value) ||
        typeof value.slug !== 'string' ||
        !('GSI1PK' in value) ||
        value.GSI1PK !== 'MOVIE'
    ) {
        return false;
    }

    return sortKey === 'GSI1SK'
        ? 'GSI1SK' in value && typeof value.GSI1SK === 'string'
        : 'score' in value && typeof value.score === 'number' && Number.isFinite(value.score);
}

function parsePageSize(value: string | undefined): number {
    if (value === undefined) return DEFAULT_PAGE_SIZE;

    const pageSize = Number(value);
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
        throw new Error(`limit must be an integer between 1 and ${MAX_PAGE_SIZE}.`);
    }
    return pageSize;
}

function parseNextToken(
    value: string | undefined,
    sortKey: MovieQueries['sortKey']
): MovieCursor | undefined {
    if (value === undefined) return undefined;

    let parsed: unknown;
    try {
        parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    } catch {
        throw new Error('nextToken is invalid.');
    }

    if (!isMovieCursor(parsed, sortKey)) {
        throw new Error('nextToken is invalid.');
    }

    return sortKey === 'GSI1SK'
        ? {
            tmdbId: parsed.tmdbId,
            slug: parsed.slug,
            GSI1PK: parsed.GSI1PK,
            GSI1SK: parsed.GSI1SK,
        }
        : {
            tmdbId: parsed.tmdbId,
            slug: parsed.slug,
            GSI1PK: parsed.GSI1PK,
            score: parsed.score,
        };
}

function getKind(routeKey: string | undefined): FeaturedMovieKind | undefined {
    if (routeKey === 'GET /movies/newest') return 'newest';
    if (routeKey === 'GET /movies/top-picks') return 'top-picks';
    return undefined;
}

export const handler = async (
    event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
    const requestId = event.requestContext?.requestId;
    const kind = getKind(event.routeKey);
    if (!kind) return json(404, { message: 'Movie endpoint not found.' });

    if (!TABLE_NAME) {
        log('ERROR', 'TABLE_NAME is not configured', { requestId });
        return json(500, { message: 'TABLE_NAME is not configured.' });
    }

    const query = movieQueries[kind];
    let limit: number;
    let exclusiveStartKey: MovieCursor | undefined;
    try {
        limit = parsePageSize(event.queryStringParameters?.limit);
        exclusiveStartKey = parseNextToken(
            event.queryStringParameters?.nextToken,
            query.sortKey
        );
    } catch (error: unknown) {
        const message = error instanceof Error
            ? error.message
            : 'Invalid pagination parameters.';
        return json(400, { message });
    }

    try {
        const result = await docClient.send(
            new QueryCommand({
                TableName: TABLE_NAME,
                IndexName: query.indexName,
                KeyConditionExpression: 'GSI1PK = :movie',
                ExpressionAttributeValues: {
                    ':movie': 'MOVIE',
                    ...(query.filterComingSoon && { ':notComingSoon': false }),
                },
                ...(query.filterComingSoon && {
                    FilterExpression:
                        'attribute_not_exists(isComingSoon) OR isComingSoon = :notComingSoon',
                }),
                Limit: limit,
                ScanIndexForward: false,
                ExclusiveStartKey: exclusiveStartKey,
            })
        );

        const nextToken = result.LastEvaluatedKey
            ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64url')
            : null;
        const movies = (result.Items ?? []).map((item) => {
            if (!isMovieRecord(item)) {
                throw new Error('DynamoDB returned an invalid movie record.');
            }
            return projectMovieSummary(item);
        });

        return json(200, { movies, nextToken });
    } catch (error: unknown) {
        log('ERROR', `Failed to retrieve ${kind} movies`, {
            requestId,
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        return json(500, { message: `Unable to retrieve ${kind} movies.` });
    }
};

type MovieQueries = typeof movieQueries;
