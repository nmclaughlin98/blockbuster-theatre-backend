import { readFile } from 'node:fs/promises';
import {
    DynamoDBDocumentClient,
    PutCommand,
    QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type { OfferRecord, PricingTier } from '../src/main/lambda/handlers/interfaces';
import { createDynamoDBClient } from '../src/main/lambda/handlers/dynamodb-client';
import { isOfferRecord } from '../src/main/lambda/handlers/pricing-service';
import { isMovieRecord } from '../src/main/lambda/handlers/utils/movie-validation';
import { pricingRecords } from './pricing-records';

function requiredEnvironmentValue(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`${name} must be set.`);
    return value;
}

function isPricingTier(value: unknown): value is PricingTier {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const tier = value as Record<string, unknown>;
    return (
        typeof tier.id === 'string' &&
        typeof tier.label === 'string' &&
        typeof tier.description === 'string' &&
        typeof tier.price === 'number' &&
        Number.isFinite(tier.price) &&
        tier.price >= 0 &&
        Math.abs(tier.price * 100 - Math.round(tier.price * 100)) < 1e-7
    );
}

async function readOffersFile(path: string): Promise<OfferRecord[]> {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (!Array.isArray(parsed)) {
        throw new Error(`${path} must contain an array of valid offer records.`);
    }
    const offers: OfferRecord[] = [];
    for (const item of parsed) {
        if (!isOfferRecord(item)) {
            throw new Error(`${path} must contain an array of valid offer records.`);
        }
        offers.push(item);
    }
    return offers;
}

async function ensureFeaturedMovie(
    client: DynamoDBDocumentClient,
    moviesTableName: string,
    featuredMovieId: string
): Promise<void> {
    const result = await client.send(
        new QueryCommand({
            TableName: moviesTableName,
            KeyConditionExpression: 'tmdbId = :tmdbId',
            ExpressionAttributeValues: { ':tmdbId': featuredMovieId },
            Limit: 2,
            ConsistentRead: true,
        })
    );
    const movies = result.Items ?? [];
    const movie = movies[0];
    if (
        movies.length !== 1 ||
        !isMovieRecord(movie) ||
        !movie.visible
    ) {
        throw new Error(
            `featuredMovieId ${featuredMovieId} must reference exactly one visible movie.`
        );
    }
}

async function main(): Promise<void> {
    const pricingTableName = requiredEnvironmentValue('PRICING_TABLE_NAME');
    const offersTableName = requiredEnvironmentValue('OFFERS_TABLE_NAME');
    const moviesTableName = requiredEnvironmentValue('MOVIES_TABLE_NAME');
    const offersFile = process.argv[2];
    const offers = offersFile ? await readOffersFile(offersFile) : [];
    const pricingIds = new Set(pricingRecords.map((record) => record.pricingId));
    const client = DynamoDBDocumentClient.from(createDynamoDBClient());

    for (const pricing of pricingRecords) {
        if (!pricing.ticketTiers.every(isPricingTier)) {
            throw new Error(`Built-in pricing record ${pricing.pricingId} is invalid.`);
        }
        await client.send(
            new PutCommand({
                TableName: pricingTableName,
                Item: pricing,
            })
        );
    }

    for (const offer of offers) {
        if (!pricingIds.has(offer.pricingId)) {
            throw new Error(
                `Offer ${offer.offerId} references an unknown built-in pricingId ${offer.pricingId}.`
            );
        }
        await ensureFeaturedMovie(client, moviesTableName, offer.featuredMovieId);
        await client.send(
            new PutCommand({
                TableName: offersTableName,
                Item: offer,
            })
        );
    }

    console.log(
        `Seeded ${pricingRecords.length} pricing records and ${offers.length} offers.`
    );
    if (!offersFile) {
        console.log('No offer data file supplied; no offer records were written.');
    }
}

main().catch((error: unknown) => {
    console.error('Failed to seed pricing and offers:', error);
    process.exitCode = 1;
});
