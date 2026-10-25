import type {
    APIGatewayProxyEventV2,
    APIGatewayProxyResultV2,
} from 'aws-lambda';
import {
    DynamoDBDocumentClient,
    GetCommand,
    QueryCommand,
    ScanCommand,
    TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import {
    listFilmSelections as resolveFilmSelections,
    resolvePricing,
    validateCheckout as validateCheckoutService,
} from '../../main/lambda/handlers/pricing-service';

process.env.TABLE_NAME = 'test-movies-table';
process.env.OFFERS_TABLE_NAME = 'test-offers-table';
process.env.PRICING_TABLE_NAME = 'test-pricing-table';
process.env.SHOWTIME_REGISTRY_TABLE_NAME = 'test-showtime-registry';

const ddbMock = mockClient(DynamoDBDocumentClient);
const registry = new Map<string, Record<string, unknown>>();
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
    showtimes: {
        Monday: [
            { screen: '1', time: '11:00' },
            { screen: '3', time: '19:00' },
        ],
        Tuesday: [{ screen: '1', time: '11:00' }],
    },
    GSI1PK: 'MOVIE',
    GSI1SK: '2026-09-25#456',
};
const comingSoonMovie = {
    ...movie,
    tmdbId: '789',
    slug: 'coming-soon',
    title: 'Coming Soon',
    isComingSoon: true,
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
    overrideShowtimes: {
        Tuesday: [{
            screen: '1',
            time: '11:00',
        }],
    },
    displayLabel: 'OFFER - A Movie - Matinee',
};
const secondOfferForSameMovie = {
    ...kidsClubOffer,
    offerId: 'kids-club-evening',
    title: 'Kids Club Evening',
    pricingId: 'CRAZY_TUESDAY_RATES',
    overrideShowtimes: {
        Tuesday: [{
            screen: '3',
            time: '19:00',
        }],
    },
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
        registry.clear();
        ddbMock
            .on(GetCommand, { TableName: 'test-showtime-registry' })
            .callsFake((input) => ({
                Item: registry.get(input.Key?.registryKey as string),
            }));
        ddbMock.on(TransactWriteCommand).callsFake((input) => {
            for (const action of input.TransactItems ?? []) {
                const item = action.Put?.Item;
                if (item && typeof item.registryKey === 'string') {
                    registry.set(item.registryKey, item);
                }
            }
            return {};
        });
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('combines visible, non-coming-soon movies and active offers for film selection', async () => {
        ddbMock.on(QueryCommand).resolves({ Items: [movie, comingSoonMovie] });
        ddbMock.on(ScanCommand).resolves({
            Items: [kidsClubOffer, secondOfferForSameMovie, { ...kidsClubOffer, isActive: false }],
        });

        const result = await listSelections(createEvent());

        expect(result).toMatchObject({ statusCode: 200 });
        const selections = responseBody(result).selections as Array<Record<string, unknown>>;
        expect(selections.map((selection) => selection.id)).toEqual([
            '456',
            'kids-club',
            'kids-club-evening',
        ]);
        const offers = selections.filter((selection) => selection.type === 'offer');
        for (const offer of offers) {
            const overrideShowtimes = offer.overrideShowtimes as Record<
                string,
                Array<Record<string, unknown>>
            >;
            const screening = overrideShowtimes.Tuesday[0];
            expect(screening.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(screening.showtimeId).toMatch(
                new RegExp(`^\\d{6}_${screening.date}_\\d{4}$`)
            );
        }
        const firstIds = offers.map((offer) => {
            const showtimes = offer.overrideShowtimes as Record<
                string,
                Array<Record<string, unknown>>
            >;
            return showtimes.Tuesday[0].showtimeId;
        });
        const repeated = await listSelections(createEvent());
        const repeatedOffers = (responseBody(repeated).selections as Array<Record<string, unknown>>)
            .filter((selection) => selection.type === 'offer');
        expect(repeatedOffers.map((offer) => {
            const showtimes = offer.overrideShowtimes as Record<
                string,
                Array<Record<string, unknown>>
            >;
            return showtimes.Tuesday[0].showtimeId;
        })).toEqual(firstIds);
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
    });

    it('accepts a numeric movie ID in pricing selection', async () => {
        ddbMock.on(QueryCommand).resolves({ Items: [movie] });
        ddbMock.on(GetCommand).resolves({ Item: offPeakPricing });

        const result = await resolvePricing({
            movieId: 456,
            showtime: { day: 'Monday', time: '11:00' },
        });

        expect(result.movieId).toBe('456');
        expect(result.pricing.pricingId).toBe('OFF_PEAK_RATES');
        expect(ddbMock.commandCalls(GetCommand)[0].args[0].input.Key).toEqual({
            pricingId: 'OFF_PEAK_RATES',
        });
    });

    it('resolves pricing for a screened movie showtime', async () => {
        ddbMock.on(QueryCommand).resolves({
            Items: [{
                ...movie,
                showtimes: {
                    Monday: [{ screen: '3', time: '13:00' }],
                },
            }],
        });
        ddbMock.on(GetCommand).resolves({ Item: offPeakPricing });

        const result = await getTicketPricing(
            createEvent({
                queryStringParameters: {
                    movieId: '456',
                    day: 'Monday',
                    time: '13:00',
                },
            })
        );

        expect(result).toMatchObject({ statusCode: 200 });
        expect(responseBody(result).pricing).toMatchObject({
            pricingId: 'OFF_PEAK_RATES',
        });
    });

    it('uses the single Crazy Tuesday tier for Tuesday movie showings at any time', async () => {
        ddbMock.on(QueryCommand).resolves({
            Items: [{
                ...movie,
                showtimes: {
                    Monday: [{ screen: '1', time: '11:00' }],
                    Tuesday: [
                        { screen: '1', time: '11:00' },
                        { screen: '3', time: '19:00' },
                    ],
                },
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

    it.each([
        ['non-object request', null],
        ['unexpected request property', {
            movieId: '456',
            showtime: { day: 'Monday', time: '11:00' },
            price: 1,
        }],
        ['missing movie or offer', { showtime: { day: 'Monday', time: '11:00' } }],
        ['both movie and offer', {
            movieId: '456',
            offerId: 'kids-club',
            showtime: { day: 'Monday', time: '11:00' },
        }],
        ['non-numeric movie ID', {
            movieId: 'a-movie',
            showtime: { day: 'Monday', time: '11:00' },
        }],
        ['blank offer ID', {
            offerId: ' ',
            showtime: { day: 'Monday', time: '11:00' },
        }],
        ['missing showtime', { movieId: '456' }],
        ['unexpected showtime property', {
            movieId: '456',
            showtime: { day: 'Monday', time: '11:00', unexpected: true },
        }],
        ['invalid day', {
            movieId: '456',
            showtime: { day: 'Funday', time: '11:00' },
        }],
        ['invalid time', {
            movieId: '456',
            showtime: { day: 'Monday', time: '25:00' },
        }],
    ])('rejects %s before accessing DynamoDB', async (_name, selection) => {
        await expect(resolvePricing(selection)).rejects.toMatchObject({ statusCode: 400 });
        expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
        expect(ddbMock.commandCalls(GetCommand)).toHaveLength(0);
    });

    it.each([
        ['empty ticket list', {
            movieId: '456',
            showtime: { day: 'Monday', time: '11:00' },
            tickets: [],
        }],
        ['non-array ticket list', {
            movieId: '456',
            showtime: { day: 'Monday', time: '11:00' },
            tickets: {},
        }],
        ['non-object ticket', {
            movieId: '456',
            showtime: { day: 'Monday', time: '11:00' },
            tickets: [null],
        }],
        ['extra ticket field', {
            movieId: '456',
            showtime: { day: 'Monday', time: '11:00' },
            tickets: [{ tierId: 'adult', quantity: 1, price: 0 }],
        }],
        ['invalid ticket quantity', {
            movieId: '456',
            showtime: { day: 'Monday', time: '11:00' },
            tickets: [{ tierId: 'adult', quantity: 0 }],
        }],
        ['blank ticket tier', {
            movieId: '456',
            showtime: { day: 'Monday', time: '11:00' },
            tickets: [{ tierId: ' ', quantity: 1 }],
        }],
        ['duplicate ticket tiers', {
            movieId: '456',
            showtime: { day: 'Monday', time: '11:00' },
            tickets: [
                { tierId: 'adult', quantity: 1 },
                { tierId: 'adult', quantity: 2 },
            ],
        }],
    ])('rejects checkout with %s', async (_name, checkout) => {
        await expect(validateCheckoutService(checkout))
            .rejects.toMatchObject({ statusCode: 400 });
    });

    it('rejects checkout totals that exceed safe integer arithmetic', async () => {
        ddbMock.on(QueryCommand).resolves({ Items: [movie] });
        ddbMock.on(GetCommand).resolves({
            Item: {
                ...offPeakPricing,
                ticketTiers: [{
                    id: 'adult',
                    label: 'Adult',
                    description: 'Adult admission',
                    price: 10000,
                }],
            },
        });

        await expect(validateCheckoutService({
            movieId: '456',
            showtime: { day: 'Monday', time: '11:00' },
            tickets: [{ tierId: 'adult', quantity: Number.MAX_SAFE_INTEGER }],
        })).rejects.toMatchObject({ statusCode: 400 });

        ddbMock.reset();
        ddbMock.on(QueryCommand).resolves({ Items: [movie] });
        ddbMock.on(GetCommand).resolves({
            Item: {
                ...offPeakPricing,
                ticketTiers: ['adult', 'child'].map((id) => ({
                    id,
                    label: id,
                    description: `${id} admission`,
                    price: 0.01,
                })),
            },
        });
        await expect(validateCheckoutService({
            movieId: '456',
            showtime: { day: 'Monday', time: '11:00' },
            tickets: [
                { tierId: 'adult', quantity: Number.MAX_SAFE_INTEGER },
                { tierId: 'child', quantity: Number.MAX_SAFE_INTEGER },
            ],
        })).rejects.toMatchObject({ statusCode: 400 });
    });

    it('rejects missing, ambiguous, invisible, and invalid movie records', async () => {
        const cases = [
            { Items: [] },
            { Items: [movie, { ...movie, slug: 'duplicate' }] },
            { Items: [{ ...movie, visible: false }] },
            { Items: [{ ...movie, title: 42 }] },
        ];

        for (const result of cases) {
            ddbMock.reset();
            ddbMock.on(QueryCommand).resolves(result);
            await expect(resolvePricing({
                movieId: '456',
                showtime: { day: 'Monday', time: '11:00' },
            })).rejects.toThrow();
        }
    });

    it('rejects missing, inactive, and invalid offer records', async () => {
        for (const result of [
            {},
            { Item: { ...kidsClubOffer, isActive: false } },
            { Item: { ...kidsClubOffer, featuredMovieId: 'invalid' } },
        ]) {
            ddbMock.reset();
            ddbMock.on(GetCommand).resolves(result);
            await expect(resolvePricing({
                offerId: 'kids-club',
                showtime: { day: 'Tuesday', time: '11:00' },
            })).rejects.toThrow();
        }
    });

    it('rejects an invalid pricing record and an unknown ticket tier', async () => {
        ddbMock.on(QueryCommand).resolves({ Items: [movie] });
        ddbMock.on(GetCommand).resolves({ Item: { ...offPeakPricing, currency: 'USD' } });
        await expect(resolvePricing({
            movieId: '456',
            showtime: { day: 'Monday', time: '11:00' },
        })).rejects.toThrow('missing or invalid');

        ddbMock.reset();
        ddbMock.on(QueryCommand).resolves({ Items: [movie] });
        ddbMock.on(GetCommand).resolves({ Item: offPeakPricing });
        await expect(validateCheckoutService({
            movieId: '456',
            showtime: { day: 'Monday', time: '11:00' },
            tickets: [{ tierId: 'unknown', quantity: 1 }],
        })).rejects.toMatchObject({ statusCode: 400 });
    });

    it('returns client errors for missing or malformed checkout bodies', async () => {
        const missing = await validateCheckout(createEvent());
        const malformed = await validateCheckout(createEvent({ body: '{' }));
        const invalidShape = await validateCheckout(createEvent({ body: 'null' }));

        expect(missing).toMatchObject({ statusCode: 400 });
        expect(responseBody(missing)).toEqual({
            message: 'A JSON request body is required.',
        });
        expect(malformed).toMatchObject({ statusCode: 400 });
        expect(responseBody(malformed)).toEqual({
            message: 'Request body must contain valid JSON.',
        });
        expect(invalidShape).toMatchObject({ statusCode: 400 });
        expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
    });

    it('returns a service error when pricing configuration is missing', async () => {
        const tableName = process.env.TABLE_NAME;
        delete process.env.TABLE_NAME;

        try {
            const result = await getTicketPricing(createEvent({
                queryStringParameters: {
                    movieId: '456',
                    day: 'Monday',
                    time: '11:00',
                },
            }));

            expect(result).toMatchObject({ statusCode: 500 });
            expect(responseBody(result)).toEqual({
                message: 'TABLE_NAME is not configured.',
            });
            const checkout = await validateCheckout(createEvent({
                body: JSON.stringify({
                    movieId: '456',
                    showtime: { day: 'Monday', time: '11:00' },
                    tickets: [{ tierId: 'adult', quantity: 1 }],
                }),
            }));
            expect(checkout).toMatchObject({ statusCode: 500 });
            expect(responseBody(checkout)).toEqual({
                message: 'TABLE_NAME is not configured.',
            });
        } finally {
            process.env.TABLE_NAME = tableName;
        }
    });

    it.each([
        ['an Error', new Error('database unavailable')],
        ['a non-Error value', 'database unavailable'],
    ])('returns a generic error for %s pricing failures', async (_name, failure) => {
        ddbMock.on(QueryCommand).callsFake(() => Promise.reject(failure));

        const result = await getTicketPricing({
            queryStringParameters: {
                movieId: '456',
                day: 'Monday',
                time: '11:00',
            },
        } as APIGatewayProxyEventV2);

        expect(result).toMatchObject({ statusCode: 500 });
        expect(responseBody(result)).toEqual({
            message: 'Unable to resolve ticket pricing.',
        });
    });

    it('returns a generic checkout error for non-service database failures', async () => {
        ddbMock.on(QueryCommand).callsFake(() => Promise.reject('database failure'));

        const result = await validateCheckout(createEvent({
            body: JSON.stringify({
                movieId: '456',
                showtime: { day: 'Monday', time: '11:00' },
                tickets: [{ tierId: 'adult', quantity: 1 }],
            }),
        }));

        expect(result).toMatchObject({ statusCode: 500 });
        expect(responseBody(result)).toEqual({
            message: 'Unable to validate checkout.',
        });
    });

    it('rejects invalid film-selection records and reads all pages', async () => {
        ddbMock.on(QueryCommand)
            .resolvesOnce({ Items: [movie], LastEvaluatedKey: { tmdbId: '456' } })
            .resolves({ Items: [{ ...comingSoonMovie, isComingSoon: false }] });
        ddbMock.on(ScanCommand)
            .resolvesOnce({ Items: [kidsClubOffer], LastEvaluatedKey: { offerId: 'kids-club' } })
            .resolves({ Items: [{ ...secondOfferForSameMovie, displayLabel: '' }] });

        await expect(resolveFilmSelections()).rejects.toThrow('invalid offer record');
        expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(2);
        expect(ddbMock.commandCalls(ScanCommand)).toHaveLength(2);
    });

    it('uses fallback labels and showtimes for offers without optional display fields', async () => {
        ddbMock.on(QueryCommand).resolves({ Items: [movie] });
        ddbMock.on(ScanCommand).resolves({
            Items: [{
                ...kidsClubOffer,
                displayLabel: undefined,
                overrideShowtimes: undefined,
            }],
        });

        const selections = await resolveFilmSelections();

        expect(selections).toContainEqual(expect.objectContaining({
            type: 'offer',
            label: 'OFFER Kids Club',
            overrideShowtimes: {},
        }));
        expect(selections[1]).not.toHaveProperty('displayLabel');
    });
});
