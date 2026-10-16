import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { json, log } from './utils/common';
import { scanTable } from './scan-table';

const TABLE_NAME = process.env.TABLE_NAME ?? '';

export const handler = async (
    event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
    const requestId = event.requestContext?.requestId;

    if (!TABLE_NAME) {
        log('ERROR', 'TABLE_NAME is not configured', { requestId });
        return json(500, { message: 'TABLE_NAME is not configured.' });
    }

    try {
        const movies = await scanTable(TABLE_NAME);
        return json(200, { movies });
    } catch (error: unknown) {
        log('ERROR', 'Failed to export movies', {
            requestId,
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        return json(500, { message: 'Unable to export movies.' });
    }
};
