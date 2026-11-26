import type {
    APIGatewayProxyEventV2,
    APIGatewayProxyResultV2,
} from 'aws-lambda';
import {
    DynamoDBDocumentClient,
    GetCommand,
    QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from '../Shared/dynamodb-client';
import type { MovieCollectionRecord, MovieRecord } from '../../lib/interfaces';
import { json, log, mapWithConcurrency } from '../utils/common';
import { projectMovieSummary } from '../utils/movie-projection';
import { isMovieRecord } from '../utils/movie-validation';
import { isMovieCollectionRecord } from '../utils/collection-validation';
import { ShowtimeIdError } from '../utils/showtime-ids';

const docClient = DynamoDBDocumentClient.from(createDynamoDBClient());
const MOVIE_TABLE_NAME = process.env.TABLE_NAME ?? '';
const COLLECTIONS_TABLE_NAME = process.env.COLLECTIONS_TABLE_NAME ?? '';

async function getMovie(tmdbId: string): Promise<MovieRecord | undefined> {
    const result = await docClient.send(
        new GetCommand({
            TableName: MOVIE_TABLE_NAME,
            Key: { movieId: tmdbId },
            ConsistentRead: true,
        }),
    );
    const item = result.Item;
    if (item && !isMovieRecord(item)) {
        throw new Error(`DynamoDB returned an invalid movie record for ${tmdbId}.`);
    }

    return item;
}

function collectionResponse(record: MovieCollectionRecord) {
    return {
        collectionId: record.collectionId,
        name: record.name,
        description: record.description,
        posterUrl: record.posterUrl,
        backdropUrl: record.backdropUrl,
        movieIds: record.movieIds,
        isActive: record.isActive ?? true,
        ...(record.lastUpdated && { lastUpdated: record.lastUpdated }),
    };
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    const requestId = event.requestContext?.requestId;
    const collectionId = event.pathParameters?.collectionId;

    if (!MOVIE_TABLE_NAME || !COLLECTIONS_TABLE_NAME) {
        log('ERROR', 'Movie or collection table is not configured', {
            requestId,
            movieTableConfigured: Boolean(MOVIE_TABLE_NAME),
            collectionsTableConfigured: Boolean(COLLECTIONS_TABLE_NAME),
        });

        return json(500, { message: 'Collection data is not configured.' });
    }

    if (!collectionId || !/^\d+$/.test(collectionId)) {
        return json(400, { message: 'A numeric collection ID is required.' });
    }

    try {
        const result = await docClient.send(
            new GetCommand({
                TableName: COLLECTIONS_TABLE_NAME,
                Key: { collectionId },
                ConsistentRead: true,
            }),
        );

        if (!result.Item || !isMovieCollectionRecord(result.Item)) {
            return json(404, { message: 'TMDB list collection not found.' });
        }

        const collection = result.Item;
        const movies = await mapWithConcurrency(collection.movieIds, 5, getMovie);
        const movieSummaries = await mapWithConcurrency(
            movies.filter((movie): movie is MovieRecord => movie !== undefined),
            5,
            async (movie) => projectMovieSummary(movie),
        );

        return json(200, {
            collection: collectionResponse(collection),
            movies: movieSummaries,
        });
    } catch (error: unknown) {
        if (error instanceof ShowtimeIdError) {
            return json(error.statusCode, { message: error.message });
        }

        log('ERROR', 'Failed to retrieve movie collection', {
            requestId,
            collectionId,
            error: error instanceof Error ? error.message : 'Unknown error',
        });

        return json(500, { message: 'Unable to retrieve movie collection.' });
    }
};
