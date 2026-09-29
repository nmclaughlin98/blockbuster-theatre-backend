import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { isMovieRecord, json, log, projectMovieDetail } from './utils';

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME ?? '';

/**
 * Retrieves one movie by its numeric TMDB ID.
 * @param event API Gateway request with the movie ID in its path.
 * @returns Movie detail or an API error response.
 */
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
            new QueryCommand({
                TableName: TABLE_NAME,
                KeyConditionExpression: 'tmdbId = :tmdbId',
                ExpressionAttributeValues: { ':tmdbId': id },
                Limit: 2,
                ConsistentRead: true,
            })
        );

        const movies = result.Items ?? [];
        if (movies.length > 1) {
            return json(409, { message: 'Multiple movie records match this ID.' });
        }
        const movie = movies[0];

        if (!movie) {
            return json(404, { message: 'Movie not found.' });
        }

        if (!isMovieRecord(movie)) {
            throw new Error('DynamoDB returned an invalid movie record.');
        }

        return json(200, projectMovieDetail(movie));
    } catch (error: unknown) {
        log('ERROR', 'Failed to retrieve movie', {
            requestId,
            id,
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        return json(500, { message: 'Unable to retrieve movie.' });
    }
};
