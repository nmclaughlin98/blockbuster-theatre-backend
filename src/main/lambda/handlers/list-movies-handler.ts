import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
    DynamoDBDocumentClient,
    QueryCommand,
    type NativeAttributeValue,
} from '@aws-sdk/lib-dynamodb';
import { isMovieRecord, json, log, projectMovieSummary } from './utils';

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME ?? '';
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

type MovieCursor = {
    tmdbId: string;
    GSI1PK: string;
    GSI1SK: string;
};

function isMovieCursor(value: unknown): value is MovieCursor {
    return (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        'tmdbId' in value &&
        typeof value.tmdbId === 'string' &&
        'GSI1PK' in value &&
        typeof value.GSI1PK === 'string' &&
        'GSI1SK' in value &&
        typeof value.GSI1SK === 'string'
    );
}

function parsePageSize(value: string | undefined): number {
    if (value === undefined) return DEFAULT_PAGE_SIZE;

    const pageSize = Number(value);
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
        throw new Error(`limit must be an integer between 1 and ${MAX_PAGE_SIZE}.`);
    }
    return pageSize;
}

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
        GSI1PK: parsed.GSI1PK,
        GSI1SK: parsed.GSI1SK,
    };
}

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

        const nextToken = result.LastEvaluatedKey
            ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64url')
            : null;

        const movies = (result.Items ?? []).map((item) => {
            if (!isMovieRecord(item)) {
                throw new Error('DynamoDB returned an invalid movie record.');
            }
            return projectMovieSummary(item);
        });

        return json(200, {
            movies,
            nextToken,
        });
    } catch (error: unknown) {
        log('ERROR', 'Failed to retrieve movies', {
            requestId,
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        return json(500, { message: 'Unable to retrieve movies.' });
    }
};
