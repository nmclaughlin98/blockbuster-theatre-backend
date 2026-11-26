import {
    CreateTableCommand,
    DescribeTableCommand,
    ListTablesCommand,
    UpdateTableCommand,
    waitUntilTableExists,
    type CreateTableCommandInput,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from '../src/main/lambda/handlers/Shared/dynamodb-client';
import type { MovieRecord } from '../src/main/lambda/lib/interfaces';
import { pricingRecords } from './pricing-records';

const endpoint = 'http://127.0.0.1:8000';
const tableNames = {
    movies: 'blockbuster-theatre-movies-table-local',
    pricing: 'blockbuster-theatre-ticket-pricing-local',
    offers: 'blockbuster-theatre-booking-offers-local',
    collections: 'blockbuster-theatre-movie-collections-local',
    bookings: 'blockbuster-theatre-bookings-table-local',
    showtimeRegistry: 'blockbuster-theatre-showtime-registry-local',
    guestConversionTokens: 'blockbuster-theatre-guest-conversion-tokens-local',
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
            { AttributeName: 'movieId', AttributeType: 'S' },
            { AttributeName: 'GSI1PK', AttributeType: 'S' },
            { AttributeName: 'GSI1SK', AttributeType: 'S' },
            { AttributeName: 'score', AttributeType: 'N' },
        ],
        KeySchema: [{ AttributeName: 'movieId', KeyType: 'HASH' }],
        GlobalSecondaryIndexes: [
            {
                IndexName: 'MoviesByReleaseDate',
                KeySchema: [
                    { AttributeName: 'GSI1PK', KeyType: 'HASH' },
                    { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
                ],
                Projection: { ProjectionType: 'ALL' },
            },
            {
                IndexName: 'MoviesByScore',
                KeySchema: [
                    { AttributeName: 'GSI1PK', KeyType: 'HASH' },
                    { AttributeName: 'score', KeyType: 'RANGE' },
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
    {
        TableName: tableNames.bookings,
        BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: [
            { AttributeName: 'PK', AttributeType: 'S' },
            { AttributeName: 'SK', AttributeType: 'S' },
            { AttributeName: 'userId', AttributeType: 'S' },
            { AttributeName: 'customerEmail', AttributeType: 'S' },
            { AttributeName: 'showtimeId', AttributeType: 'S' },
            { AttributeName: 'screeningKey', AttributeType: 'S' },
        ],
        KeySchema: [
            { AttributeName: 'PK', KeyType: 'HASH' },
            { AttributeName: 'SK', KeyType: 'RANGE' },
        ],
        GlobalSecondaryIndexes: [
            {
                IndexName: 'UserBookings',
                KeySchema: [
                    { AttributeName: 'userId', KeyType: 'HASH' },
                    { AttributeName: 'screeningKey', KeyType: 'RANGE' },
                ],
                Projection: { ProjectionType: 'ALL' },
            },
            {
                IndexName: 'CustomerEmailBookings',
                KeySchema: [
                    { AttributeName: 'customerEmail', KeyType: 'HASH' },
                    { AttributeName: 'screeningKey', KeyType: 'RANGE' },
                ],
                Projection: { ProjectionType: 'ALL' },
            },
            {
                IndexName: 'ShowtimeBookings',
                KeySchema: [
                    { AttributeName: 'showtimeId', KeyType: 'HASH' },
                    { AttributeName: 'screeningKey', KeyType: 'RANGE' },
                ],
                Projection: { ProjectionType: 'ALL' },
            },
        ],
    },
    {
        TableName: tableNames.showtimeRegistry,
        BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: [
            { AttributeName: 'registryKey', AttributeType: 'S' },
            { AttributeName: 'GSI1PK', AttributeType: 'S' },
            { AttributeName: 'GSI1SK', AttributeType: 'S' },
        ],
        KeySchema: [{ AttributeName: 'registryKey', KeyType: 'HASH' }],
        GlobalSecondaryIndexes: [
            {
                IndexName: 'ShowtimesByDate',
                KeySchema: [
                    { AttributeName: 'GSI1PK', KeyType: 'HASH' },
                    { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
                ],
                Projection: { ProjectionType: 'ALL' },
            },
        ],
    },
    {
        TableName: tableNames.guestConversionTokens,
        BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: [{ AttributeName: 'tokenHash', AttributeType: 'S' }],
        KeySchema: [{ AttributeName: 'tokenHash', KeyType: 'HASH' }],
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

    throw new Error(`DynamoDB Local did not become ready at ${endpoint}.`, { cause: lastError });
}

async function createTableIfMissing(input: CreateTableCommandInput): Promise<void> {
    const tableName = input.TableName;

    if (!tableName) throw new Error('Local table definition is missing TableName.');

    try {
        const description = await client.send(new DescribeTableCommand({ TableName: tableName }));
        const existingIndexes = new Set(
            description.Table?.GlobalSecondaryIndexes?.flatMap((index) =>
                index.IndexName ? [index.IndexName] : [],
            ) ?? [],
        );

        const missingIndexes = (input.GlobalSecondaryIndexes ?? []).filter(
            (index) => index.IndexName !== undefined && !existingIndexes.has(index.IndexName),
        );

        if (missingIndexes.length === 0) return;

        const existingAttributes = new Set(
            description.Table?.AttributeDefinitions
                ?.map((attribute) => attribute.AttributeName)
                .filter((name): name is string => typeof name === 'string') ?? []
        );
        for (const index of missingIndexes) {
            const requiredIndexAttributes = new Set(index.KeySchema?.map((key) => key.AttributeName));
            const newAttributeDefinitions = (input.AttributeDefinitions ?? []).filter(
                (attribute) => typeof attribute.AttributeName === 'string'
                    && requiredIndexAttributes.has(attribute.AttributeName)
                    && !existingAttributes.has(attribute.AttributeName)
            );

            await client.send(
                new UpdateTableCommand({
                    TableName: tableName,
                    AttributeDefinitions: indexAttributeDefinitions,
                    GlobalSecondaryIndexUpdates: [{ Create: index }],
                }),
            );

            let active = false;
            for (let attempt = 0; attempt < 30; attempt++) {
                const updated = await client.send(new DescribeTableCommand({ TableName: tableName }));
                active = updated.Table?.GlobalSecondaryIndexes?.some(
                    (entry) => entry.IndexName === index.IndexName && entry.IndexStatus === 'ACTIVE'
                ) ?? false;
                if (active) break;
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }

            if (!active) throw new Error(`Local index ${index.IndexName} did not become active.`);
        }

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
    movieId: string;
    entityType: string;
    GSI1PK: string;
    GSI1SK: string;
} = {
    movieId: '99999999',
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
    startDate: '2026-01-01',
    preSalesEligible: false,
    entityType: 'Movie',
    GSI1PK: 'MOVIE',
    GSI1SK: '2026-01-01#99999999',
};

async function putIfMissing(tableName: string, key: Record<string, string>, item: object) {
    const existing = await docClient.send(
        new GetCommand({
            TableName: tableName,
            Key: key,
        }),
    );

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
        { movieId: demoMovie.movieId },
        demoMovie,
    );

    console.log(`Local DynamoDB ready at ${endpoint}.`);
    console.log(`Seeded ${seededPricing} missing pricing packages.`);
    console.log(`Demo movie ${demoMovie.tmdbId} ${seededMovie ? 'created' : 'already exists'}.`);
    console.log('No offers were created. Add local offers with POST /api/v1/offers.');
}

main().catch((error: unknown) => {
    console.error('Failed to initialize local DynamoDB:', error);
    process.exitCode = 1;
});
