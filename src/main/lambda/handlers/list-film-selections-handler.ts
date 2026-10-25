import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { listFilmSelections } from './pricing-service';
import { json, log } from './utils/common';
import { ShowtimeIdError } from './utils/showtime-ids';

export const handler = async (
    event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
    const requestId = event.requestContext?.requestId;
    try {
        return json(200, {
            selections: await listFilmSelections(event.queryStringParameters?.date),
        });
    } catch (error: unknown) {
        if (error instanceof ShowtimeIdError) {
            return json(error.statusCode, { message: error.message });
        }
        log('ERROR', 'Failed to retrieve film selections', {
            requestId,
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        return json(500, {
            message: 'Unable to retrieve film selections.',
            requestId,
        });
    }
};
