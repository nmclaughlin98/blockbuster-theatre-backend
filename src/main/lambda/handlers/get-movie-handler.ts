import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { isMovieRecord, json, log, projectMovieDetail } from './utils';

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME ?? '';


export const handler = async (
    event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
    const requestId = event.requestContext?.requestId;
    const id = event.pathParameters?.id;

    if (!TABLE_NAME) {
        log('ERROR', 'TABLE_NAME is not configured', { requestId });
        return json(500, { message: 'TABLE_NAME is not configured.' });
    }

    if (!id || !/^\d+$/.test(id)) {
        return json(400, { message: 'A numeric movie ID is required.' });
    }

    try {
        const result = await docClient.send(
            new GetCommand({
                TableName: TABLE_NAME,
                Key: { tmdbId: id },
            })
        );

        if (!result.Item) {
            return json(404, { message: 'Movie not found.' });
        }

        if (!isMovieRecord(result.Item)) {
            throw new Error('DynamoDB returned an invalid movie record.');
        }

        return json(200, projectMovieDetail(result.Item));
    } catch (error: unknown) {
        log('ERROR', 'Failed to retrieve movie', {
            requestId,
            id,
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        return json(500, { message: 'Unable to retrieve movie.' });
    }
};
