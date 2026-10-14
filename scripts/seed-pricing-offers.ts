import { readFile } from 'node:fs/promises';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
    DynamoDBDocumentClient,
    PutCommand,
    QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type { OfferRecord, PricingRecord, PricingTier } from '../src/main/lambda/handlers/interfaces';
import { isOfferRecord } from '../src/main/lambda/handlers/pricing-service';
import { isMovieRecord } from '../src/main/lambda/handlers/utils';

const pricingRecords: PricingRecord[] = [
    {
        pricingId: 'STANDARD_RATES',
        name: 'Standard Peak Rates',
        currency: 'GBP',
        ticketTiers: [
            { id: 'adult', label: 'Standard Adult', description: 'Standard adult admission', price: 9.5 },
            { id: 'child', label: 'Child Ticket', description: 'Child admission', price: 6 },
            { id: 'student', label: 'Student Ticket', description: 'Student admission', price: 7.5 },
            { id: 'senior', label: 'Senior / OAP', description: 'Senior admission', price: 7 },
        ],
    },
    {
        pricingId: 'OFF_PEAK_RATES',
        name: 'Off-Peak Rates',
        currency: 'GBP',
        ticketTiers: [
            { id: 'adult', label: 'Standard Adult', description: 'Off-peak adult admission', price: 7.6 },
            { id: 'child', label: 'Child Ticket', description: 'Off-peak child admission', price: 4.8 },
            { id: 'student', label: 'Student Ticket', description: 'Off-peak student admission', price: 6 },
            { id: 'senior', label: 'Senior / OAP', description: 'Off-peak senior admission', price: 5.6 },
        ],
    },
    {
        pricingId: 'KIDS_CLUB_RATES',
        name: 'Kids Club Rates',
        currency: 'GBP',
        ticketTiers: [
            { id: 'child', label: 'Kids Club Ticket', description: 'Kids Club child admission', price: 2.5 },
        ],
    },
    {
        pricingId: 'CRAZY_TUESDAY_RATES',
        name: 'Crazy Tuesday Rates',
        currency: 'GBP',
        ticketTiers: [
            { id: 'adult', label: 'Standard Adult', description: 'Crazy Tuesday adult admission', price: 4 },
            { id: 'child', label: 'Child Ticket', description: 'Crazy Tuesday child admission', price: 4 },
            { id: 'student', label: 'Student Ticket', description: 'Crazy Tuesday student admission', price: 4 },
            { id: 'senior', label: 'Senior / OAP', description: 'Crazy Tuesday senior admission', price: 4 },
        ],
    },
];

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
    const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

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
}

main().catch((error: unknown) => {
    console.error('Failed to seed pricing and offers:', error);
    process.exitCode = 1;
});
