import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { listFilmSelections } from './pricing-service';
import { json, log } from './utils';

export const handler = async (
    event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
    const requestId = event.requestContext?.requestId;
    try {
        return json(200, { selections: await listFilmSelections() });
    } catch (error: unknown) {
        log('ERROR', 'Failed to retrieve film selections', {
            requestId,
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        return json(500, { message: 'Unable to retrieve film selections.' });
    }
};
