import type {
    APIGatewayProxyEventV2,
    APIGatewayProxyResultV2,
} from 'aws-lambda';
import {
    DynamoDBDocumentClient,
    TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';

process.env.OFFERS_TABLE_NAME = 'test-booking-offers';
process.env.PRICING_TABLE_NAME = 'test-ticket-pricing';

const ddbMock = mockClient(DynamoDBDocumentClient);
const { handler: upsertOffers } = require('../../main/lambda/handlers/upsert-booking-offers-handler') as {
    handler: (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;
};
const { handler: upsertPricing } = require('../../main/lambda/handlers/upsert-ticket-pricing-handler') as {
    handler: (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;
};

const offer = {
    offerId: 'kids-club',
    title: 'Kids Club',
    tagline: 'Every Tuesday',
    priceDescription: '£2.50 per child',
    ctaLabel: 'Claim Offer',
    featuredMovieId: '456',
    pricingId: 'KIDS_CLUB_RATES',
    isActive: true,
    overrideShowtimes: { Tuesday: [{ screen: '1', time: '11:00' }] },
};

const pricing = {
    pricingId: 'KIDS_CLUB_RATES',
    name: 'Kids Club Rates',
    currency: 'GBP',
    ticketTiers: [
        {
            id: 'child',
            label: 'Kids Club Child Ticket',
            description: 'Kids Club admission per child',
            price: 2.5,
        },
    ],
};

function createEvent(body?: string): APIGatewayProxyEventV2 {
    return {
        body,
        requestContext: { requestId: 'bulk-upsert-test-request' },
    } as unknown as APIGatewayProxyEventV2;
}

function responseBody(result: APIGatewayProxyResultV2): Record<string, unknown> {
    if (typeof result === 'string') {
        throw new Error('Expected a structured API Gateway response.');
    }
    return JSON.parse(result.body as string) as Record<string, unknown>;
}

describe('Bulk booking data upsert handlers', () => {
    beforeEach(() => {
        ddbMock.reset();
        ddbMock.on(TransactWriteCommand).resolves({});
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('upserts submitted offer records atomically by offerId', async () => {
        const result = await upsertOffers(
            createEvent(JSON.stringify({ offers: [offer] }))
        );

        expect(result).toMatchObject({ statusCode: 200 });
        expect(responseBody(result)).toMatchObject({ count: 1, ids: ['kids-club'] });
        expect(ddbMock.commandCalls(TransactWriteCommand)[0].args[0].input).toEqual({
            TransactItems: [
                {
                    Put: {
                        TableName: 'test-booking-offers',
                        Item: offer,
                    },
                },
            ],
        });
    });

    it('upserts submitted pricing records atomically by pricingId', async () => {
        const result = await upsertPricing(
            createEvent(JSON.stringify({ pricing: [pricing] }))
        );

        expect(result).toMatchObject({ statusCode: 200 });
        expect(responseBody(result)).toMatchObject({ count: 1, ids: ['KIDS_CLUB_RATES'] });
        expect(ddbMock.commandCalls(TransactWriteCommand)[0].args[0].input).toEqual({
            TransactItems: [
                {
                    Put: {
                        TableName: 'test-ticket-pricing',
                        Item: pricing,
                    },
                },
            ],
        });
    });

    it('rejects malformed records before writing anything', async () => {
        const result = await upsertOffers(
            createEvent(JSON.stringify({
                offers: [{ ...offer, featuredMovieId: 456 }],
            }))
        );

        expect(result).toMatchObject({ statusCode: 400 });
        expect(responseBody(result)).toEqual({
            message: 'One or more booking offers records are invalid.',
            invalidIndexes: [0],
        });
        expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
    });

    it('rejects legacy string showtimes in offer overrides', async () => {
        const result = await upsertOffers(
            createEvent(JSON.stringify({
                offers: [{
                    ...offer,
                    overrideShowtimes: { Tuesday: ['11:00'] },
                }],
            }))
        );

        expect(result).toMatchObject({ statusCode: 400 });
        expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
    });

    it('rejects duplicate keys in a request', async () => {
        const result = await upsertPricing(
            createEvent(JSON.stringify({ pricing: [pricing, pricing] }))
        );

        expect(result).toMatchObject({ statusCode: 400 });
        expect(responseBody(result)).toEqual({
            message: 'Duplicate pricingId values are not allowed in one request.',
            duplicateIds: ['KIDS_CLUB_RATES'],
        });
        expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
    });

    it('rejects empty or oversized batches', async () => {
        const empty = await upsertOffers(createEvent(JSON.stringify({ offers: [] })));
        const oversized = await upsertPricing(
            createEvent(JSON.stringify({ pricing: Array.from({ length: 26 }, () => pricing) }))
        );

        expect(empty).toMatchObject({ statusCode: 400 });
        expect(responseBody(empty)).toEqual({
            message: 'offers must be a non-empty array.',
        });
        expect(oversized).toMatchObject({ statusCode: 400 });
        expect(responseBody(oversized)).toEqual({
            message: 'pricing cannot exceed 25 items per request.',
        });
        expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
    });

    it('reports DynamoDB write failures with a request ID', async () => {
        ddbMock.on(TransactWriteCommand).rejects(new Error('DynamoDB unavailable'));

        const result = await upsertOffers(
            createEvent(JSON.stringify({ offers: [offer] }))
        );

        expect(result).toMatchObject({ statusCode: 500 });
        expect(responseBody(result)).toEqual({
            message: 'Unable to save booking offers.',
            requestId: 'bulk-upsert-test-request',
        });
    });
});
