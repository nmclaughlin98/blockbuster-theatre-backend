import type {
    APIGatewayProxyEventV2,
    APIGatewayProxyResultV2,
} from 'aws-lambda';
import {
    DynamoDBDocumentClient,
    GetCommand,
    QueryCommand,
    type NativeAttributeValue,
} from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from './dynamodb-client';
import type { MovieCollectionRecord, MovieRecord } from './interfaces';
import { json, log, mapWithConcurrency } from './utils/common';
import { projectMovieSummary } from './utils/movie-projection';
import { isMovieRecord } from './utils/movie-validation';
import { isMovieCollectionRecord } from './utils/collection-validation';

const docClient = DynamoDBDocumentClient.from(createDynamoDBClient());
const MOVIE_TABLE_NAME = process.env.TABLE_NAME ?? '';
const COLLECTIONS_TABLE_NAME = process.env.COLLECTIONS_TABLE_NAME ?? '';

function collectionResponse(record: MovieCollectionRecord) {
    return {
        collectionId: record.collectionId,
        name: record.name,
        overview: record.overview,
        poster: record.poster,
        backdrop: record.backdrop,
        ...(record.parentCollectionId && {
            parentCollectionId: record.parentCollectionId,
        }),
        sortOrder: record.sortOrder,
    };
}

async function queryPages<T>(
    query: (exclusiveStartKey?: Record<string, NativeAttributeValue>) => Promise<{
        Items?: Record<string, NativeAttributeValue>[];
        LastEvaluatedKey?: Record<string, NativeAttributeValue>;
    }>,
    isValid: (item: unknown) => item is T,
    invalidMessage: string
): Promise<T[]> {
    const items: T[] = [];
    let exclusiveStartKey: Record<string, NativeAttributeValue> | undefined;

    do {
        const result = await query(exclusiveStartKey);
        for (const item of result.Items ?? []) {
            if (!isValid(item)) throw new Error(invalidMessage);
            items.push(item);
        }
        exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return items;
}

async function getChildCollections(parentCollectionId: string): Promise<MovieCollectionRecord[]> {
    const children = await queryPages(
        (ExclusiveStartKey) => docClient.send(
            new QueryCommand({
                TableName: COLLECTIONS_TABLE_NAME,
                IndexName: 'GSI1',
                KeyConditionExpression: 'GSI1PK = :parent',
                ExpressionAttributeValues: {
                    ':parent': `PARENT#${parentCollectionId}`,
                },
                ScanIndexForward: true,
                ExclusiveStartKey,
            })
        ),
        isMovieCollectionRecord,
        'DynamoDB returned an invalid movie collection record.'
    );
    return children;
}

async function getCollectionMovies(collectionId: string): Promise<MovieRecord[]> {
    const movies = await queryPages(
        (ExclusiveStartKey) => docClient.send(
            new QueryCommand({
                TableName: MOVIE_TABLE_NAME,
                IndexName: 'GSI2',
                KeyConditionExpression: 'GSI2PK = :collection',
                ExpressionAttributeValues: {
                    ':collection': `COLLECTION#${collectionId}`,
                },
                ScanIndexForward: true,
                ExclusiveStartKey,
            })
        ),
        isMovieRecord,
        'DynamoDB returned an invalid movie record.'
    );
    if (movies.some((movie) => movie.collectionId !== collectionId)) {
        throw new Error('DynamoDB returned a movie assigned to the wrong collection.');
    }
    return movies;
}

export const handler = async (
    event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
    const requestId = event.requestContext?.requestId;
    const collectionId = event.pathParameters?.id;

    if (!MOVIE_TABLE_NAME || !COLLECTIONS_TABLE_NAME) {
        log('ERROR', 'Movie or collection table is not configured', {
            requestId,
            movieTableConfigured: Boolean(MOVIE_TABLE_NAME),
            collectionsTableConfigured: Boolean(COLLECTIONS_TABLE_NAME),
        });
        return json(500, { message: 'Movie collection data is not configured.' });
    }
    if (!collectionId || !/^\d+$/.test(collectionId)) {
        return json(400, { message: 'A numeric collection ID is required.' });
    }

    try {
        const result = await docClient.send(
            new GetCommand({
                TableName: COLLECTIONS_TABLE_NAME,
                Key: { collectionId },
            })
        );
        if (!result.Item) {
            return json(404, { message: 'Movie collection not found.' });
        }
        if (!isMovieCollectionRecord(result.Item)) {
            throw new Error('DynamoDB returned an invalid movie collection record.');
        }
        const root = result.Item;
        const collections = [root];
        const visited = new Set([root.collectionId]);

        async function collectDescendants(parentId: string): Promise<void> {
            const children = await getChildCollections(parentId);
            for (const child of children) {
                if (visited.has(child.collectionId)) {
                    throw new Error('Collection hierarchy contains a cycle.');
                }
                visited.add(child.collectionId);
                collections.push(child);
                await collectDescendants(child.collectionId);
            }
        }
        await collectDescendants(root.collectionId);

        const moviesByCollection = await mapWithConcurrency(
            collections,
            5,
            (collection) => getCollectionMovies(collection.collectionId)
        );

        return json(200, {
            collection: collectionResponse(root),
            childCollections: collections.slice(1).map(collectionResponse),
            movies: moviesByCollection.flat().map(projectMovieSummary),
        });
    } catch (error: unknown) {
        log('ERROR', 'Failed to retrieve movie collection', {
            requestId,
            collectionId,
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        return json(500, { message: 'Unable to retrieve movie collection.' });
    }
};
