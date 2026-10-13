import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { json, log } from './utils';
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
        const items = await scanTable(TABLE_NAME, {
            projectionExpression: '#tmdbId',
            expressionAttributeNames: { '#tmdbId': 'tmdbId' },
        });
        const tmdbIds = [...new Set(items.map((item) => item.tmdbId))];
        return json(200, { tmdbIds });
    } catch (error: unknown) {
        log('ERROR', 'Failed to retrieve TMDB IDs', {
            requestId,
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        return json(500, { message: 'Unable to retrieve TMDB IDs.' });
    }
};
