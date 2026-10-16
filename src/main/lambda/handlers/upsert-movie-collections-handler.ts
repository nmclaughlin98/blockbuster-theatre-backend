import type {
    APIGatewayProxyEventV2,
    APIGatewayProxyResultV2,
} from 'aws-lambda';
import {
    DynamoDBDocumentClient,
    GetCommand,
    TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from './dynamodb-client';
import type { MovieCollectionInput, MovieCollectionRecord } from './interfaces';
import { json, log } from './utils/common';
import { isMovieCollectionRecord, isMovieCollectionInput } from './utils/collection-validation';

const docClient = DynamoDBDocumentClient.from(createDynamoDBClient());
const MAX_BATCH = 25;
const MAX_SORT_ORDER = Number.MAX_SAFE_INTEGER;

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function validateHierarchy(
    tableName: string,
    records: MovieCollectionInput[]
): Promise<{ message: string; collectionId: string; parentCollectionId?: string } | undefined> {
    const proposed = new Map(records.map((record) => [record.collectionId, record]));
    const stored = new Map<string, MovieCollectionRecord | undefined>();

    async function getParentCollection(
        collectionId: string
    ): Promise<MovieCollectionRecord | MovieCollectionInput | undefined> {
        const proposedCollection = proposed.get(collectionId);
        if (proposedCollection) return proposedCollection;
        if (!stored.has(collectionId)) {
            const result = await docClient.send(
                new GetCommand({
                    TableName: tableName,
                    Key: { collectionId },
                })
            );
            const item = result.Item;
            if (item && !isMovieCollectionRecord(item)) {
                throw new Error(`Collection ${collectionId} has an invalid stored record.`);
            }
            stored.set(collectionId, item as MovieCollectionRecord | undefined);
        }
        return stored.get(collectionId);
    }

    for (const record of records) {
        const visited = new Set([record.collectionId]);
        let parentCollectionId = record.parentCollectionId;

        while (parentCollectionId) {
            if (visited.has(parentCollectionId)) {
                return {
                    message: 'Collection hierarchy cannot contain a cycle.',
                    collectionId: record.collectionId,
                    parentCollectionId,
                };
            }
            visited.add(parentCollectionId);

            const parent = await getParentCollection(parentCollectionId);
            if (!parent) {
                return {
                    message: 'Parent collection does not exist.',
                    collectionId: record.collectionId,
                    parentCollectionId,
                };
            }
            parentCollectionId = parent.parentCollectionId;
        }
    }
}

function toItem(record: MovieCollectionInput): MovieCollectionRecord {
    const sortOrder = record.sortOrder ?? 0;
    return {
        collectionId: record.collectionId,
        name: record.name.trim(),
        overview: record.overview,
        poster: record.poster,
        backdrop: record.backdrop,
        sortOrder,
        ...(record.parentCollectionId && {
            parentCollectionId: record.parentCollectionId,
            GSI1PK: `PARENT#${record.parentCollectionId}`,
            GSI1SK: `${String(sortOrder).padStart(16, '0')}#${record.collectionId}`,
        }),
        lastUpdated: new Date().toISOString(),
    };
}

export const handler = async (
    event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
    const requestId = event.requestContext?.requestId;
    const tableName = process.env.COLLECTIONS_TABLE_NAME;
    if (!tableName) {
        log('ERROR', 'COLLECTIONS_TABLE_NAME is not configured', { requestId });
        return json(500, { message: 'COLLECTIONS_TABLE_NAME is not configured.', requestId });
    }
    if (!event.body) return json(400, { message: 'Missing request body.' });

    let body: unknown;
    try {
        body = JSON.parse(event.body);
    } catch {
        return json(400, { message: 'Request body is not valid JSON.' });
    }

    const records = isObject(body) ? body.collections : undefined;
    if (!Array.isArray(records) || records.length === 0) {
        return json(400, { message: 'collections must be a non-empty array.' });
    }
    if (records.length > MAX_BATCH) {
        return json(400, { message: `collections cannot exceed ${MAX_BATCH} items per request.` });
    }

    const invalidIndexes: number[] = [];
    const validRecords: MovieCollectionInput[] = [];
    const seenIds = new Set<string>();
    const duplicateIds = new Set<string>();
    records.forEach((record, index) => {
        if (
            !isMovieCollectionInput(record) ||
            (record.sortOrder !== undefined && record.sortOrder > MAX_SORT_ORDER)
        ) {
            invalidIndexes.push(index);
            return;
        }
        if (seenIds.has(record.collectionId)) duplicateIds.add(record.collectionId);
        seenIds.add(record.collectionId);
        validRecords.push(record);
    });

    if (invalidIndexes.length) {
        return json(400, {
            message: 'One or more movie collections records are invalid.',
            invalidIndexes,
        });
    }
    if (duplicateIds.size) {
        return json(400, {
            message: 'Duplicate collectionId values are not allowed in one request.',
            duplicateIds: [...duplicateIds],
        });
    }

    try {
        const hierarchyError = await validateHierarchy(tableName, validRecords);
        if (hierarchyError) return json(400, hierarchyError);

        await docClient.send(
            new TransactWriteCommand({
                TransactItems: validRecords.map((record) => ({
                    Put: {
                        TableName: tableName,
                        Item: toItem(record),
                    },
                })),
            })
        );
    } catch (error: unknown) {
        log('ERROR', 'Failed to upsert movie collections', {
            requestId,
            count: validRecords.length,
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        return json(500, {
            message: 'Unable to save movie collections.',
            requestId,
        });
    }

    return json(200, {
        message: 'Movie collections upserted successfully.',
        count: validRecords.length,
        ids: validRecords.map((record) => record.collectionId),
    });
};
