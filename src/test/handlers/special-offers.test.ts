import type {
    APIGatewayProxyEventV2,
    APIGatewayProxyResultV2,
} from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';

process.env.TABLE_NAME = 'test-movies-table';
process.env.OFFERS_TABLE_NAME = 'test-offers-table';
process.env.PRICING_TABLE_NAME = 'test-pricing-table';

const ddbMock = mockClient(DynamoDBDocumentClient);
const { handler: listSelections } = require('../../main/lambda/handlers/list-film-selections-handler') as {
    handler: (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;
};
const { handler: getTicketPricing } = require('../../main/lambda/handlers/get-ticket-pricing-handler') as {
    handler: (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;
};
const { handler: validateCheckout } = require('../../main/lambda/handlers/validate-checkout-handler') as {
    handler: (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;
};

const movie = {
    tmdbId: '456',
    slug: 'a-movie',
    title: 'A Movie',
    visible: true,
    isComingSoon: false,
    genres: ['Adventure'],
    mainGenre: 'Adventure',
    rating: 'PG',
    score: 7.4,
    runtime: 110,
    releaseDate: '2026-09-25T00:00:00.000Z',
    poster: 'https://example.com/poster.jpg',
    still: 'https://example.com/still.jpg',
    starring: ['Actor One'],
    director: 'Director Name',
    synopsis: 'A short description.',
    tagline: 'A tagline.',
    trailer: 'https://example.com/trailer',
    showtimes: { Monday: ['11:00', '19:00'], Tuesday: ['11:00'] },
    GSI1PK: 'MOVIE',
    GSI1SK: '2026-09-25#456',
};

const kidsClubOffer = {
    offerId: 'kids-club',
    title: 'Kids Club',
    tagline: 'Every Tuesday',
    priceDescription: 'Tickets from £2.50',
    ctaLabel: 'Book tickets',
    featuredMovieId: '456',
    pricingId: 'KIDS_CLUB_RATES',
    isActive: true,
    overrideShowtimes: { Tuesday: ['11:00'] },
    displayLabel: 'OFFER - A Movie - Matinee',
};
const secondOfferForSameMovie = {
    ...kidsClubOffer,
    offerId: 'kids-club-evening',
    title: 'Kids Club Evening',
    pricingId: 'CRAZY_TUESDAY_RATES',
    overrideShowtimes: { Tuesday: ['19:00'] },
};

const offPeakPricing = {
    pricingId: 'OFF_PEAK_RATES',
    name: 'Off-Peak Rates',
    currency: 'GBP',
    ticketTiers: [
        { id: 'adult', label: 'Standard Adult', description: 'Adult admission', price: 7.6 },
        { id: 'child', label: 'Child Ticket', description: 'Child admission', price: 4.8 },
    ],
};

const kidsClubPricing = {
    pricingId: 'KIDS_CLUB_RATES',
    name: 'Kids Club Rates',
    currency: 'GBP',
    ticketTiers: [
        { id: 'child', label: 'Kids Club Ticket', description: 'Kids Club child admission', price: 2.5 },
    ],
};

const crazyTuesdayPricing = {
    pricingId: 'CRAZY_TUESDAY_RATES',
    name: 'Crazy Tuesday Rates',
    currency: 'GBP',
    ticketTiers: [
        {
            id: 'crazy-tuesday',
            label: 'Crazy Tuesday Ticket',
            description: 'Admission for any Tuesday movie showing',
            price: 4,
        },
    ],
};

function createEvent(options: {
    queryStringParameters?: Record<string, string>;
    body?: string;
} = {}): APIGatewayProxyEventV2 {
    return {
        queryStringParameters: options.queryStringParameters,
        body: options.body,
        requestContext: { requestId: 'special-offers-test-request' },
    } as unknown as APIGatewayProxyEventV2;
}

function responseBody(result: APIGatewayProxyResultV2): Record<string, unknown> {
    if (typeof result === 'string') {
        throw new Error('Expected a structured API Gateway response.');
    }
    return JSON.parse(result.body as string) as Record<string, unknown>;
}

describe('Special offers and pricing handlers', () => {
    beforeEach(() => {
        ddbMock.reset();
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('combines visible movies and active offers for film selection', async () => {
        ddbMock.on(QueryCommand).resolves({ Items: [movie] });
        ddbMock.on(ScanCommand).resolves({
            Items: [kidsClubOffer, secondOfferForSameMovie, { ...kidsClubOffer, isActive: false }],
        });

        const result = await listSelections(createEvent());

        expect(result).toMatchObject({ statusCode: 200 });
        expect(responseBody(result).selections).toEqual([
            {
                type: 'movie',
                id: '456',
                movieId: 456,
                title: 'A Movie',
                label: 'A Movie',
            },
            {
                type: 'offer',
                id: 'kids-club',
                offerId: 'kids-club',
                title: 'Kids Club',
                label: 'OFFER - A Movie - Matinee',
                featuredMovieId: '456',
                pricingId: 'KIDS_CLUB_RATES',
                overrideShowtimes: { Tuesday: ['11:00'] },
            },
            {
                type: 'offer',
                id: 'kids-club-evening',
                offerId: 'kids-club-evening',
                title: 'Kids Club Evening',
                label: 'OFFER - A Movie - Matinee',
                featuredMovieId: '456',
                pricingId: 'CRAZY_TUESDAY_RATES',
                overrideShowtimes: { Tuesday: ['19:00'] },
            },
        ]);
        expect(ddbMock.commandCalls(QueryCommand)[0].args[0].input.IndexName).toBe('GSI1');
        expect(ddbMock.commandCalls(ScanCommand)[0].args[0].input.TableName).toBe(
            'test-offers-table'
        );
    });

    it('returns a request ID when film selection retrieval fails', async () => {
        const offersTableName = process.env.OFFERS_TABLE_NAME;
        delete process.env.OFFERS_TABLE_NAME;

        try {
            const result = await listSelections(createEvent());

            expect(result).toMatchObject({ statusCode: 500 });
            expect(responseBody(result)).toEqual({
                message: 'Unable to retrieve film selections.',
                requestId: 'special-offers-test-request',
            });
        } finally {
            process.env.OFFERS_TABLE_NAME = offersTableName;
        }
    });

    it('selects off-peak rates for a weekday show before 17:00', async () => {
        ddbMock.on(QueryCommand).resolves({ Items: [movie] });
        ddbMock.on(GetCommand).resolves({ Item: offPeakPricing });

        const result = await getTicketPricing(
            createEvent({
                queryStringParameters: {
                    movieId: '456',
                    day: 'Monday',
                    time: '11:00',
                },
            })
        );

        expect(result).toMatchObject({ statusCode: 200 });
        expect(responseBody(result).pricing).toMatchObject({
            pricingId: 'OFF_PEAK_RATES',
            ticketTiers: offPeakPricing.ticketTiers,
        });
        expect(ddbMock.commandCalls(GetCommand)[0].args[0].input.Key).toEqual({
            pricingId: 'OFF_PEAK_RATES',
        });
    });

    it('uses the single Crazy Tuesday tier for Tuesday movie showings at any time', async () => {
        ddbMock.on(QueryCommand).resolves({
            Items: [{
                ...movie,
                showtimes: { Monday: ['11:00'], Tuesday: ['11:00', '19:00'] },
            }],
        });
        ddbMock.on(GetCommand).resolves({ Item: crazyTuesdayPricing });

        for (const time of ['11:00', '19:00']) {
            const result = await getTicketPricing(
                createEvent({
                    queryStringParameters: {
                        movieId: '456',
                        day: 'Tuesday',
                        time,
                    },
                })
            );

            expect(result).toMatchObject({ statusCode: 200 });
            expect(responseBody(result).pricing).toEqual(crazyTuesdayPricing);
        }
        expect(ddbMock.commandCalls(GetCommand)).toHaveLength(2);
        expect(ddbMock.commandCalls(GetCommand).map(({ args }) => args[0].input.Key)).toEqual([
            { pricingId: 'CRAZY_TUESDAY_RATES' },
            { pricingId: 'CRAZY_TUESDAY_RATES' },
        ]);
    });

    it('keeps offer-specific showtimes and pricing on Tuesday', async () => {
        ddbMock.on(GetCommand).callsFake((input) => {
            if (input.TableName === 'test-offers-table') {
                return { Item: kidsClubOffer };
            }
            return { Item: kidsClubPricing };
        });
        ddbMock.on(QueryCommand).resolves({ Items: [movie] });

        const result = await getTicketPricing(
            createEvent({
                queryStringParameters: {
                    offerId: 'kids-club',
                    day: 'Tuesday',
                    time: '11:00',
                },
            })
        );

        expect(result).toMatchObject({ statusCode: 200 });
        expect(responseBody(result)).toMatchObject({
            movieId: '456',
            offerId: 'kids-club',
            pricing: { pricingId: 'KIDS_CLUB_RATES' },
        });

        const invalidShowtime = await getTicketPricing(
            createEvent({
                queryStringParameters: {
                    offerId: 'kids-club',
                    day: 'Tuesday',
                    time: '19:00',
                },
            })
        );
        expect(invalidShowtime).toMatchObject({ statusCode: 400 });
    });

    it('validates checkout totals from the selected offer pricing', async () => {
        ddbMock.on(GetCommand).callsFake((input) => {
            if (input.TableName === 'test-offers-table') {
                return { Item: kidsClubOffer };
            }
            return { Item: kidsClubPricing };
        });
        ddbMock.on(QueryCommand).resolves({ Items: [movie] });

        const result = await validateCheckout(
            createEvent({
                body: JSON.stringify({
                    offerId: 'kids-club',
                    showtime: { day: 'Tuesday', time: '11:00' },
                    tickets: [{ tierId: 'child', quantity: 2 }],
                }),
            })
        );

        expect(result).toMatchObject({ statusCode: 200 });
        expect(responseBody(result)).toMatchObject({
            offerId: 'kids-club',
            pricingId: 'KIDS_CLUB_RATES',
            currency: 'GBP',
            tickets: [{ tierId: 'child', quantity: 2, unitPrice: 2.5, subtotal: 5 }],
            total: 5,
        });
        expect(ddbMock.commandCalls(GetCommand).map((call) => call.args[0].input.TableName)).toEqual([
            'test-offers-table',
            'test-pricing-table',
        ]);
    });

    it('rejects client-supplied prices without reading DynamoDB', async () => {
        const result = await validateCheckout(
            createEvent({
                body: JSON.stringify({
                    offerId: 'kids-club',
                    showtime: { day: 'Tuesday', time: '11:00' },
                    tickets: [{ tierId: 'child', quantity: 2, price: 0.01 }],
                }),
            })
        );

        expect(result).toMatchObject({ statusCode: 400 });
        expect(responseBody(result)).toEqual({
            message: 'Ticket items only accept tierId and quantity.',
        });
        expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
        expect(ddbMock.commandCalls(GetCommand)).toHaveLength(0);
    });

    it('rejects an unscheduled showtime before reading its price plan', async () => {
        ddbMock.on(QueryCommand).resolves({ Items: [movie] });

        const result = await getTicketPricing(
            createEvent({
                queryStringParameters: {
                    movieId: '456',
                    day: 'Monday',
                    time: '13:00',
                },
            })
        );

        expect(result).toMatchObject({ statusCode: 400 });
        expect(responseBody(result)).toEqual({
            message: 'The selected showtime is not available.',
        });
        expect(ddbMock.commandCalls(GetCommand)).toHaveLength(0);
    });
});
