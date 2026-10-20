import {
    CreateTableCommand,
    DescribeTableCommand,
    ListTablesCommand,
    UpdateTableCommand,
    waitUntilTableExists,
    type CreateTableCommandInput,
} from '@aws-sdk/client-dynamodb';
import {
    DynamoDBDocumentClient,
    GetCommand,
    PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from '../src/main/lambda/handlers/dynamodb-client';
import type { MovieRecord } from '../src/main/lambda/handlers/interfaces';
import { pricingRecords } from './pricing-records';

const endpoint = 'http://127.0.0.1:8000';
const tableNames = {
    movies: 'blockbuster-theatre-movie-catalogue-local',
    pricing: 'blockbuster-theatre-ticket-pricing-local',
    offers: 'blockbuster-theatre-booking-offers-local',
    collections: 'blockbuster-theatre-movie-collections-local',
};

process.env.LOCAL_API = 'true';
process.env.LOCAL_API_DATABASE = 'local';
process.env.DYNAMODB_ENDPOINT = endpoint;
process.env.AWS_REGION = 'eu-west-2';

const client = createDynamoDBClient();
const docClient = DynamoDBDocumentClient.from(client);

const tableDefinitions: CreateTableCommandInput[] = [
    {
        TableName: tableNames.movies,
        BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: [
            { AttributeName: 'tmdbId', AttributeType: 'S' },
            { AttributeName: 'slug', AttributeType: 'S' },
            { AttributeName: 'GSI1PK', AttributeType: 'S' },
            { AttributeName: 'GSI1SK', AttributeType: 'S' },
        ],
        KeySchema: [
            { AttributeName: 'tmdbId', KeyType: 'HASH' },
            { AttributeName: 'slug', KeyType: 'RANGE' },
        ],
        GlobalSecondaryIndexes: [
            {
                IndexName: 'GSI1',
                KeySchema: [
                    { AttributeName: 'GSI1PK', KeyType: 'HASH' },
                    { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
                ],
                Projection: { ProjectionType: 'ALL' },
            },
        ],
    },
    {
        TableName: tableNames.pricing,
        BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: [{ AttributeName: 'pricingId', AttributeType: 'S' }],
        KeySchema: [{ AttributeName: 'pricingId', KeyType: 'HASH' }],
    },
    {
        TableName: tableNames.offers,
        BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: [{ AttributeName: 'offerId', AttributeType: 'S' }],
        KeySchema: [{ AttributeName: 'offerId', KeyType: 'HASH' }],
    },
    {
        TableName: tableNames.collections,
        BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: [{ AttributeName: 'collectionId', AttributeType: 'S' }],
        KeySchema: [{ AttributeName: 'collectionId', KeyType: 'HASH' }],
    },
];

async function waitForLocalDynamoDB(): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 30; attempt++) {
        try {
            await client.send(new ListTablesCommand({}));
            return;
        } catch (error: unknown) {
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
    }

    throw new Error(
        `DynamoDB Local did not become ready at ${endpoint}.`,
        { cause: lastError }
    );
}

async function createTableIfMissing(input: CreateTableCommandInput): Promise<void> {
    const tableName = input.TableName;
    if (!tableName) throw new Error('Local table definition is missing TableName.');

    try {
        const description = await client.send(
            new DescribeTableCommand({ TableName: tableName })
        );
        const existingIndexes = new Set(
            description.Table?.GlobalSecondaryIndexes?.flatMap((index) =>
                index.IndexName ? [index.IndexName] : []
            ) ?? []
        );
        const missingIndexes = (input.GlobalSecondaryIndexes ?? []).filter(
            (index) => index.IndexName !== undefined && !existingIndexes.has(index.IndexName)
        );
        if (missingIndexes.length === 0) return;

        const existingAttributes = new Set(
            description.Table?.AttributeDefinitions
                ?.map((attribute) => attribute.AttributeName)
                .filter((name): name is string => typeof name === 'string') ?? []
        );
        const requiredIndexAttributes = new Set(
            missingIndexes.flatMap((index) =>
                index.KeySchema?.flatMap((key) =>
                    key.AttributeName ? [key.AttributeName] : []
                ) ?? []
            )
        );
        const newAttributeDefinitions = (input.AttributeDefinitions ?? []).filter(
            (attribute) =>
                typeof attribute.AttributeName === 'string' &&
                requiredIndexAttributes.has(attribute.AttributeName) &&
                !existingAttributes.has(attribute.AttributeName)
        );

        await client.send(
            new UpdateTableCommand({
                TableName: tableName,
                ...(newAttributeDefinitions.length && {
                    AttributeDefinitions: newAttributeDefinitions,
                }),
                GlobalSecondaryIndexUpdates: missingIndexes.map((index) => ({
                    Create: index,
                })),
            })
        );
        await waitUntilTableExists({ client, maxWaitTime: 30 }, { TableName: tableName });
        return;
    } catch (error: unknown) {
        if (
            typeof error !== 'object' ||
            error === null ||
            !('$metadata' in error) ||
            !('name' in error) ||
            error.name !== 'ResourceNotFoundException'
        ) {
            throw error;
        }
    }

    await client.send(new CreateTableCommand(input));
    await waitUntilTableExists({ client, maxWaitTime: 30 }, { TableName: tableName });
}

const demoMovie: MovieRecord & {
    entityType: string;
    GSI1PK: string;
    GSI1SK: string;
} = {
    tmdbId: '99999999',
    slug: 'local-demo-movie',
    title: 'Local Demo Movie',
    visible: true,
    isComingSoon: false,
    isCarousel: false,
    genres: ['Adventure'],
    mainGenre: 'Adventure',
    rating: 'PG',
    score: 7,
    runtime: 100,
    releaseDate: '2026-01-01T00:00:00.000Z',
    poster: '',
    still: '',
    starring: ['Local Test Actor'],
    director: 'Local Test Director',
    synopsis: 'A sample movie record for local API testing.',
    tagline: 'Local development fixture.',
    trailer: '',
    showtimes: {
        Monday: [
            { screen: '1', time: '11:00' },
            { screen: '3', time: '19:00' },
        ],
        Tuesday: [
            { screen: '1', time: '11:00' },
            { screen: '3', time: '19:00' },
        ],
        Wednesday: [
            { screen: '1', time: '11:00' },
            { screen: '3', time: '19:00' },
        ],
        Thursday: [
            { screen: '1', time: '11:00' },
            { screen: '3', time: '19:00' },
        ],
        Friday: [
            { screen: '1', time: '11:00' },
            { screen: '3', time: '19:00' },
        ],
        Saturday: [
            { screen: '1', time: '11:00' },
            { screen: '3', time: '19:00' },
        ],
        Sunday: [
            { screen: '1', time: '11:00' },
            { screen: '3', time: '19:00' },
        ],
    },
    entityType: 'Movie',
    GSI1PK: 'MOVIE',
    GSI1SK: '2026-01-01#99999999',
};

async function putIfMissing(tableName: string, key: Record<string, string>, item: object) {
    const existing = await docClient.send(new GetCommand({
        TableName: tableName,
        Key: key,
    }));
    if (existing.Item) return false;

    await docClient.send(new PutCommand({ TableName: tableName, Item: item }));
    return true;
}

async function main(): Promise<void> {
    await waitForLocalDynamoDB();
    for (const tableDefinition of tableDefinitions) {
        await createTableIfMissing(tableDefinition);
    }

    let seededPricing = 0;
    for (const pricing of pricingRecords) {
        if (await putIfMissing(tableNames.pricing, { pricingId: pricing.pricingId }, pricing)) {
            seededPricing++;
        }
    }
    const seededMovie = await putIfMissing(
        tableNames.movies,
        { tmdbId: demoMovie.tmdbId, slug: demoMovie.slug },
        demoMovie
    );

    console.log(`Local DynamoDB ready at ${endpoint}.`);
    console.log(`Seeded ${seededPricing} missing pricing packages.`);
    console.log(`Demo movie ${demoMovie.tmdbId} ${seededMovie ? 'created' : 'already exists'}.`);
    console.log('No offers were created. Add local offers with POST /booking-offers.');
}

main().catch((error: unknown) => {
    console.error('Failed to initialize local DynamoDB:', error);
    process.exitCode = 1;
});
