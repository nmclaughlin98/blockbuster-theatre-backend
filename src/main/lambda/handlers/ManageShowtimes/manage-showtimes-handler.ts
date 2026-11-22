import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
    cancelManualShowtime,
    createManualShowtime,
    MovieScheduleError,
    updateManualShowtime,
} from '../utils/movie-schedule-service';
import { json, log } from '../utils/common';

export const handler = async (
    event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
    const requestId = event.requestContext?.requestId;
    const movieId = event.queryStringParameters?.movieId;
    if (!movieId || !/^\d+$/.test(movieId)) {
        return json(400, { message: 'movieId query parameter is required.' });
    }

    const method = event.requestContext.http.method;
    const showtimeId = event.pathParameters?.showtimeId;
    let body: unknown;
    if (method === 'POST' || method === 'PATCH') {
        if (!event.body) return json(400, { message: 'A JSON request body is required.' });
        try {
            body = JSON.parse(
                event.isBase64Encoded
                    ? Buffer.from(event.body, 'base64').toString('utf8')
                    : event.body
            );
        } catch {
            return json(400, { message: 'Request body must contain valid JSON.' });
        }
    }

    try {
        if (method === 'POST') {
            return json(201, await createManualShowtime(movieId, body));
        }
        if (method === 'PATCH' && showtimeId) {
            return json(200, await updateManualShowtime(movieId, showtimeId, body));
        }
        if (method === 'DELETE' && showtimeId) {
            await cancelManualShowtime(movieId, showtimeId);
            return json(200, { showtimeId, cancelled: true });
        }
        return json(405, { message: 'Method not allowed.' });
    } catch (error: unknown) {
        if (error instanceof MovieScheduleError) {
            if (error.statusCode >= 500) {
                log('ERROR', 'Failed to manage screening', {
                    requestId,
                    error: error.message,
                });
            }
            return json(error.statusCode, { message: error.message });
        }
        log('ERROR', 'Failed to manage screening', {
            requestId,
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        return json(500, { message: 'Unable to manage screening.' });
    }
};
