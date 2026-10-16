import type {
    APIGatewayProxyEventV2,
    APIGatewayProxyResultV2,
} from 'aws-lambda';
import {
    DynamoDBDocumentClient,
    GetCommand,
    QueryCommand,
    TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';

process.env.TABLE_NAME = 'test-movies';
process.env.COLLECTIONS_TABLE_NAME = 'test-collections';

const ddbMock = mockClient(DynamoDBDocumentClient);
const { handler: upsertCollections } = require(
    '../../main/lambda/handlers/upsert-movie-collections-handler'
) as {
    handler: (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;
};
const { handler: getCollection } = require(
    '../../main/lambda/handlers/get-movie-collection-handler'
) as {
    handler: (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;
};

function createEvent(body?: string, id?: string): APIGatewayProxyEventV2 {
    return {
        body,
        pathParameters: id ? { id } : undefined,
        requestContext: { requestId: 'movie-collections-test-request' },
    } as unknown as APIGatewayProxyEventV2;
}

function responseBody(result: APIGatewayProxyResultV2): Record<string, any> {
    if (typeof result === 'string') {
        throw new Error('Expected a structured API Gateway response.');
    }
    return JSON.parse(result.body as string);
}

const rootCollection = {
    collectionId: '10',
    name: 'Star Wars Collection',
    overview: 'The Star Wars films',
    poster: 'https://example.com/star-wars.jpg',
    backdrop: 'https://example.com/star-wars-backdrop.jpg',
    sortOrder: 0,
};

const childCollection = {
    collectionId: '20',
    name: 'Rogue One Collection',
    overview: 'Rogue One stories',
    poster: 'https://example.com/rogue-one.jpg',
    backdrop: 'https://example.com/rogue-one-backdrop.jpg',
    parentCollectionId: '10',
    sortOrder: 2,
    GSI1PK: 'PARENT#10',
    GSI1SK: `${String(2).padStart(16, '0')}#20`,
};

function movie(tmdbId: string, collectionId: string, sortTitle: string) {
    return {
        tmdbId,
        slug: `movie-${tmdbId}`,
        collectionId,
        sortTitle,
        title: `Movie ${tmdbId}`,
        visible: true,
        isComingSoon: false,
        isCarousel: false,
        genres: ['Adventure'],
        mainGenre: 'Adventure',
        rating: 'PG',
        score: 8,
        runtime: 120,
        releaseDate: '2025-01-01T00:00:00.000Z',
        poster: '',
        largePoster: '',
        still: '',
        largeStill: '',
        starring: [],
        director: 'Director',
        synopsis: 'Synopsis',
        tagline: '',
        trailer: '',
        showtimes: {},
    };
}

describe('Movie collection handlers', () => {
    beforeEach(() => {
        ddbMock.reset();
        ddbMock.on(GetCommand).resolves({});
        ddbMock.on(QueryCommand).resolves({ Items: [] });
        ddbMock.on(TransactWriteCommand).resolves({});
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('upserts child collections with an ordered parent index', async () => {
        const result = await upsertCollections(createEvent(JSON.stringify({
            collections: [
                { ...rootCollection, sortOrder: 0 },
                { ...childCollection, GSI1PK: undefined, GSI1SK: undefined },
            ],
        })));

        expect(result).toMatchObject({ statusCode: 200 });
        expect(responseBody(result)).toMatchObject({
            count: 2,
            ids: ['10', '20'],
        });
        expect(ddbMock.commandCalls(GetCommand)).toHaveLength(0);
        const items = ddbMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems;
        expect(items?.[1]).toMatchObject({
            Put: {
                TableName: 'test-collections',
                Item: {
                    collectionId: '20',
                    parentCollectionId: '10',
                    sortOrder: 2,
                    GSI1PK: 'PARENT#10',
                    GSI1SK: `${String(2).padStart(16, '0')}#20`,
                },
            },
        });
    });

    it('rejects missing parents and circular hierarchies before writing', async () => {
        const missingParent = await upsertCollections(createEvent(JSON.stringify({
            collections: [{ ...rootCollection, parentCollectionId: '404' }],
        })));
        expect(missingParent).toMatchObject({ statusCode: 400 });
        expect(responseBody(missingParent)).toMatchObject({
            message: 'Parent collection does not exist.',
            parentCollectionId: '404',
        });

        const cycle = await upsertCollections(createEvent(JSON.stringify({
            collections: [
                { ...rootCollection, parentCollectionId: '20' },
                { ...childCollection, parentCollectionId: '10' },
            ],
        })));
        expect(cycle).toMatchObject({ statusCode: 400 });
        expect(responseBody(cycle).message).toBe('Collection hierarchy cannot contain a cycle.');
        expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
    });

    it('returns a parent collection, ordered descendants, and each movie once', async () => {
        ddbMock.on(GetCommand).resolves({ Item: rootCollection });
        ddbMock.on(QueryCommand).callsFake((input) => {
            const values = input.ExpressionAttributeValues as Record<string, string>;
            if (input.IndexName === 'GSI1' && values[':parent'] === 'PARENT#10') {
                return { Items: [childCollection] };
            }
            if (input.IndexName === 'GSI2' && values[':collection'] === 'COLLECTION#10') {
                return { Items: [movie('100', '10', 'Star Wars 01')] };
            }
            if (input.IndexName === 'GSI2' && values[':collection'] === 'COLLECTION#20') {
                return { Items: [movie('200', '20', 'Star Wars 03.5')] };
            }
            return { Items: [] };
        });

        const result = await getCollection(createEvent(undefined, '10'));

        expect(result).toMatchObject({ statusCode: 200 });
        expect(responseBody(result)).toMatchObject({
            collection: {
                collectionId: '10',
                name: 'Star Wars Collection',
            },
            childCollections: [
                {
                    collectionId: '20',
                    parentCollectionId: '10',
                    sortOrder: 2,
                },
            ],
            movies: [
                { movieId: 100, collectionId: '10' },
                { movieId: 200, collectionId: '20' },
            ],
        });
        expect(responseBody(result).movies).toHaveLength(2);
    });

    it('validates the collection ID and returns 404 for an unknown collection', async () => {
        const invalidId = await getCollection(createEvent(undefined, 'abc'));
        expect(invalidId).toMatchObject({ statusCode: 400 });

        const missing = await getCollection(createEvent(undefined, '404'));
        expect(missing).toMatchObject({ statusCode: 404 });
        expect(responseBody(missing)).toEqual({ message: 'Movie collection not found.' });
    });
});
