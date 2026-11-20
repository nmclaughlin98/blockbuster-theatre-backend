import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from '../../main/lambda/handlers/Shared/dynamodb-client';
import { json, log } from '../../main/lambda/handlers/utils/common';
import { projectMovieDetail } from '../../main/lambda/handlers/utils/movie-projection';
import { isMovieRecord } from '../../main/lambda/handlers/utils/movie-validation';
import { ShowtimeIdError } from '../../main/lambda/handlers/utils/showtime-ids';
import { MovieScheduleError } from '../../services/showtimes/movie-schedule-service';

const docClient = DynamoDBDocumentClient.from(createDynamoDBClient());
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
    const id = event.pathParameters?.movieId;

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
                Key: { movieId: id },
                ConsistentRead: true,
            })
        );
        const movie = result.Item;

        if (!movie) {
            return json(404, { message: 'Movie not found.' });
        }

        if (!isMovieRecord(movie)) {
            throw new Error('DynamoDB returned an invalid movie record.');
        }

        return json(
            200,
            await projectMovieDetail(
                movie,
                event.queryStringParameters?.date
            )
        );
    } catch (error: unknown) {
        if (error instanceof ShowtimeIdError) {
            return json(error.statusCode, { message: error.message });
        }
        if (error instanceof MovieScheduleError) {
            return json(error.statusCode, { message: error.message });
        }
        log('ERROR', 'Failed to retrieve movie', {
            requestId,
            id,
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        return json(500, { message: 'Unable to retrieve movie.' });
    }
};
