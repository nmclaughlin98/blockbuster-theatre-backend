import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
    DynamoDBDocumentClient,
    GetCommand,
    UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from '../../main/lambda/handlers/Shared/dynamodb-client';
import { intEnv, json, log, mapWithConcurrency, normalizeMovieIds } from '../../main/lambda/handlers/utils/common';
import { isMovieRecord } from '../../main/lambda/handlers/utils/movie-validation';

const docClient = DynamoDBDocumentClient.from(createDynamoDBClient(), {
    marshallOptions: { removeUndefinedValues: true },
});

const TABLE_NAME = process.env.TABLE_NAME ?? '';
const MAX_BATCH = intEnv('MAX_BATCH', 25);
const CONCURRENCY = intEnv('UPDATE_CONCURRENCY', 5);
const mutableFields = new Set([
    'slug',
    'sortTitle',
    'title',
    'visible',
    'isComingSoon',
    'isCarousel',
    'genres',
    'rating',
    'score',
    'runtime',
    'releaseDate',
    'startDate',
    'runEndDate',
    'preSalesEligible',
    'poster',
    'still',
    'starring',
    'director',
    'synopsis',
    'trailer',
]);

type MovieUpdates = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isValidFieldValue(field: string, value: unknown): boolean {
    if (field === 'slug') {
        return typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
    }

    if (field === 'sortTitle') {
        return typeof value === 'string' && Boolean(value.trim());
    }

    if (['visible', 'isComingSoon', 'isCarousel', 'preSalesEligible'].includes(field)) {
        return typeof value === 'boolean';
    }

    if (['score', 'runtime'].includes(field)) {
        return typeof value === 'number' && Number.isFinite(value);
    }

    if (['genres', 'starring'].includes(field)) {
        return isStringArray(value);
    }

    if (['startDate', 'runEndDate'].includes(field)) {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

        const date = new Date(`${value}T00:00:00.000Z`);

        return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
    }

    return typeof value === 'string';
}

function isMovieUpdates(value: unknown): value is MovieUpdates {
    return (
        isRecord(value) &&
        Object.keys(value).length > 0 &&
        Object.entries(value).every(
            ([field, fieldValue]) => mutableFields.has(field) && isValidFieldValue(field, fieldValue),
        )
    );
}

async function updateMovie(id: string, updates: MovieUpdates): Promise<void> {
    const result = await docClient.send(
        new GetCommand({
            TableName: TABLE_NAME,
            Key: { movieId: id },
            ConsistentRead: true,
        }),
    );
    if (!result.Item) {
        throw new Error('Movie not found.');
    }

    if (!isMovieRecord(result.Item)) {
        throw new Error('DynamoDB returned an invalid movie record.');
    }

    const current = result.Item;
    const startDate = typeof updates.startDate === 'string' ? updates.startDate : current.startDate;
    const runEndDate = typeof updates.runEndDate === 'string' ? updates.runEndDate : current.runEndDate;
    if (startDate && runEndDate && runEndDate < startDate) {
        throw new Error('runEndDate must be on or after startDate.');
    }

    if (typeof updates.slug === 'string' && updates.slug !== current.slug) {
        const updated: Record<string, unknown> = { ...current, ...updates, slug: updates.slug };
        delete updated.collectionId;
        delete updated.GSI2PK;
        delete updated.GSI2SK;
        delete updated.showtimes;
        if (typeof updates.releaseDate === 'string') {
            updated.GSI1SK = `${updates.releaseDate || '0000-00-00'}#${id}`;
        }
        await docClient.send(
            new TransactWriteCommand({
                TransactItems: [
                    {
                        Delete: {
                            TableName: TABLE_NAME,
                            Key: { tmdbId: id, slug: current.slug },
                            ConditionExpression: 'attribute_exists(tmdbId)',
                        },
                    },
                    {
                        Put: {
                            TableName: TABLE_NAME,
                            Item: updated,
                            ConditionExpression: 'attribute_not_exists(tmdbId)',
                        },
                    },
                ],
            })
        );
        return;
    }

    const fields = Object.keys(updates).filter((field) => field !== 'slug');
    if (fields.length === 0) return;

    const updateAssignments = fields.map((_, index) => `#field${index} = :value${index}`);
    const expressionAttributeNames = Object.fromEntries(
        fields.map((field, index) => [`#field${index}`, field]),
    );

    const expressionAttributeValues = Object.fromEntries(
        fields.map((field, index) => [`:value${index}`, updates[field]]),
    );

    if (Object.hasOwn(updates, 'releaseDate')) {
        expressionAttributeNames['#gsi1sk'] = 'GSI1SK';
        expressionAttributeValues[':gsi1sk'] = `${updates.releaseDate || '0000-00-00'}#${id}`;
        updateAssignments.push('#gsi1sk = :gsi1sk');
    }

    await docClient.send(
        new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { movieId: id },
            UpdateExpression: `SET ${updateAssignments.join(', ')} REMOVE collectionId, GSI2PK, GSI2SK, showtimes`,
            ConditionExpression: 'attribute_exists(movieId)',
            ExpressionAttributeNames: expressionAttributeNames,
            ExpressionAttributeValues: expressionAttributeValues,
        }),
    );
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    const requestId = event.requestContext?.requestId;

    try {
        log('INFO', 'Received update-movies request', { requestId });

        if (!TABLE_NAME) {
            log('ERROR', 'TABLE_NAME is not configured', { requestId });

            return json(500, { message: 'TABLE_NAME is not configured.' });
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

        const request = isRecord(parsed) ? parsed : undefined;
        const movieIds = request?.movieIds;
        const updates = request?.updates;

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
            log('WARN', 'Request rejected: non-numeric movie IDs supplied', {
                requestId,
                invalid,
            });

            return json(400, {
                message: 'All movieIds must be numeric TMDB IDs.',
                invalid,
            });
        }

        if (!isMovieUpdates(updates)) {
            log('WARN', 'Request rejected: updates are invalid or empty', { requestId });

            return json(400, {
                message: 'updates must contain one or more valid movie attributes.',
            });
        }

        const results = await mapWithConcurrency(ids, CONCURRENCY, async (id) => {
            try {
                await updateMovie(id, updates);

                return { id, status: 'SUCCESS' as const };
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : 'Failed to update movie';
                log('ERROR', 'Movie update failed', { requestId, id, error: message });

                return { id, status: 'FAILED' as const, error: message };
            }
        });

        const successful = results.filter((result) => result.status === 'SUCCESS');
        const failed = results.filter((result) => result.status === 'FAILED');

        log('INFO', 'Movie update batch complete', {
            requestId,
            total: ids.length,
            successCount: successful.length,
            failedCount: failed.length,
        });

        return json(200, {
            message: `Updated ${ids.length} movie(s).`,
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
            message: 'Internal server error processing batch update.',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
};
