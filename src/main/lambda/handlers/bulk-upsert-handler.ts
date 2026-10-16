import type {
    APIGatewayProxyEventV2,
    APIGatewayProxyResultV2,
} from 'aws-lambda';
import {
    DynamoDBDocumentClient,
    TransactWriteCommand,
    type NativeAttributeValue,
} from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from './dynamodb-client';
import { json, log } from './utils';

const docClient = DynamoDBDocumentClient.from(createDynamoDBClient());
const MAX_BATCH = 25;

interface BulkUpsertOptions<T> {
    tableEnvironmentVariable: string;
    collectionName: string;
    idField: string;
    entityName: string;
    isRecord: (value: unknown) => value is T;
    getId: (record: T) => string;
    toItem: (record: T) => Record<string, NativeAttributeValue>;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createBulkUpsertHandler<T>(options: BulkUpsertOptions<T>) {
    return async (
        event: APIGatewayProxyEventV2
    ): Promise<APIGatewayProxyResultV2> => {
        const requestId = event.requestContext?.requestId;
        const tableName = process.env[options.tableEnvironmentVariable];
        if (!tableName) {
            log('ERROR', 'Bulk upsert table is not configured', {
                requestId,
                tableEnvironmentVariable: options.tableEnvironmentVariable,
            });
            return json(500, { message: 'The data table is not configured.', requestId });
        }

        if (!event.body) {
            return json(400, { message: 'Missing request body.' });
        }

        let body: unknown;
        try {
            body = JSON.parse(event.body);
        } catch {
            return json(400, { message: 'Request body is not valid JSON.' });
        }

        const records = isObject(body) ? body[options.collectionName] : undefined;
        if (!Array.isArray(records) || records.length === 0) {
            return json(400, {
                message: `${options.collectionName} must be a non-empty array.`,
            });
        }
        if (records.length > MAX_BATCH) {
            return json(400, {
                message: `${options.collectionName} cannot exceed ${MAX_BATCH} items per request.`,
            });
        }

        const invalidIndexes: number[] = [];
        const duplicateIds = new Set<string>();
        const seenIds = new Set<string>();
        const validRecords: T[] = [];

        records.forEach((record, index) => {
            if (!options.isRecord(record)) {
                invalidIndexes.push(index);
                return;
            }
            const id = options.getId(record);
            if (seenIds.has(id)) {
                duplicateIds.add(id);
            }
            seenIds.add(id);
            validRecords.push(record);
        });

        if (invalidIndexes.length > 0) {
            return json(400, {
                message: `One or more ${options.entityName} records are invalid.`,
                invalidIndexes,
            });
        }
        if (duplicateIds.size > 0) {
            return json(400, {
                message: `Duplicate ${options.idField} values are not allowed in one request.`,
                duplicateIds: [...duplicateIds],
            });
        }

        try {
            await docClient.send(
                new TransactWriteCommand({
                    TransactItems: validRecords.map((record) => ({
                        Put: {
                            TableName: tableName,
                            Item: options.toItem(record),
                        },
                    })),
                })
            );
        } catch (error: unknown) {
            log('ERROR', `Failed to upsert ${options.entityName}`, {
                requestId,
                count: validRecords.length,
                error: error instanceof Error ? error.message : 'Unknown error',
            });
            return json(500, {
                message: `Unable to save ${options.entityName}.`,
                requestId,
            });
        }

        return json(200, {
            message: `${options.entityName} upserted successfully.`,
            count: validRecords.length,
            ids: validRecords.map(options.getId),
        });
    };
}
