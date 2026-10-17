import type {
    APIGatewayProxyEventV2,
    APIGatewayProxyResultV2,
} from 'aws-lambda';
import { json, log } from './utils/common';
import { scanTable } from './scan-table';
import { isMovieCollectionRecord } from './utils/collection-validation';

const COLLECTIONS_TABLE_NAME = process.env.COLLECTIONS_TABLE_NAME ?? '';

export const handler = async (
    event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
    const requestId = event.requestContext?.requestId;

    if (!COLLECTIONS_TABLE_NAME) {
        log('ERROR', 'Collection table is not configured', { requestId });
        return json(500, { message: 'Collection data is not configured.' });
    }

    try {
        const records = await scanTable(COLLECTIONS_TABLE_NAME);
        const collections = records
            .map((record) => {
                if (!isMovieCollectionRecord(record)) {
                    throw new Error('DynamoDB returned an invalid movie collection record.');
                }
                return {
                collectionId: record.collectionId,
                name: record.name,
                description: record.description,
                posterUrl: record.posterUrl,
                backdropUrl: record.backdropUrl,
                movieCount: record.movieIds.length,
                ...(record.lastUpdated && { lastUpdated: record.lastUpdated }),
                };
            })
            .sort((a, b) => (
                a.name.localeCompare(b.name) ||
                a.collectionId.localeCompare(b.collectionId)
            ));

        return json(200, { collections });
    } catch (error: unknown) {
        log('ERROR', 'Failed to retrieve movie collections', {
            requestId,
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        return json(500, {
            message: 'Unable to retrieve movie collections.',
            requestId,
        });
    }
};
