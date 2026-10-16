import {
    DynamoDBDocumentClient,
    GetCommand,
    QueryCommand,
    ScanCommand,
    type NativeAttributeValue,
} from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from './dynamodb-client';
import type { MovieRecord, OfferRecord, PricingRecord, PricingTier } from './interfaces';
import { isMovieRecord } from './utils/movie-validation';

const docClient = DynamoDBDocumentClient.from(createDynamoDBClient());
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

type UnknownRecord = Record<string, unknown>;
type DdbKey = Record<string, NativeAttributeValue>;

export class PricingServiceError extends Error {
    constructor(
        public readonly statusCode: number,
        message: string
    ) {
        super(message);
        this.name = 'PricingServiceError';
    }
}

export interface ShowtimeSelection {
    day: string;
    time: string;
}

export interface ResolvedPricing {
    movieId: string;
    movieTitle: string;
    offerId?: string;
    offerTitle?: string;
    showtime: ShowtimeSelection;
    pricing: PricingRecord;
}

export interface TicketRequest {
    tierId: string;
    quantity: number;
}

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isShowtimes(value: unknown): value is Record<string, string[]> {
    return (
        isRecord(value) &&
        Object.entries(value).every(
            ([day, times]) =>
                DAYS.includes(day) &&
                isStringArray(times) &&
                times.every((time) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))
        )
    );
}

export function isOfferRecord(value: unknown): value is OfferRecord {
    return (
        isRecord(value) &&
        typeof value.offerId === 'string' &&
        value.offerId.length > 0 &&
        typeof value.title === 'string' &&
        typeof value.tagline === 'string' &&
        typeof value.priceDescription === 'string' &&
        typeof value.ctaLabel === 'string' &&
        typeof value.featuredMovieId === 'string' &&
        /^\d+$/.test(value.featuredMovieId) &&
        typeof value.pricingId === 'string' &&
        value.pricingId.length > 0 &&
        typeof value.isActive === 'boolean' &&
        (value.displayLabel === undefined ||
            (typeof value.displayLabel === 'string' && value.displayLabel.length > 0)) &&
        (value.overrideShowtimes === undefined || isShowtimes(value.overrideShowtimes))
    );
}

function isPricingTier(value: unknown): value is PricingTier {
    return (
        isRecord(value) &&
        typeof value.id === 'string' &&
        value.id.length > 0 &&
        typeof value.label === 'string' &&
        typeof value.description === 'string' &&
        typeof value.price === 'number' &&
        Number.isFinite(value.price) &&
        value.price >= 0 &&
        Math.abs(value.price * 100 - Math.round(value.price * 100)) < 1e-7
    );
}

export function isPricingRecord(value: unknown): value is PricingRecord {
    return (
        isRecord(value) &&
        typeof value.pricingId === 'string' &&
        value.pricingId.length > 0 &&
        typeof value.name === 'string' &&
        value.name.length > 0 &&
        value.currency === 'GBP' &&
        Array.isArray(value.ticketTiers) &&
        value.ticketTiers.length > 0 &&
        value.ticketTiers.every(isPricingTier) &&
        new Set(value.ticketTiers.map((tier) => tier.id)).size === value.ticketTiers.length
    );
}

function requiredTableName(name: string): string {
    const tableName = process.env[name];
    if (!tableName) {
        throw new PricingServiceError(500, `${name} is not configured.`);
    }
    return tableName;
}

function parseSelection(value: unknown): {
    movieId?: string;
    offerId?: string;
    showtime: ShowtimeSelection;
} {
    if (!isRecord(value)) {
        throw new PricingServiceError(400, 'A JSON request object is required.');
    }
    if (
        Object.keys(value).some(
            (key) => !['movieId', 'offerId', 'showtime', 'tickets'].includes(key)
        )
    ) {
        throw new PricingServiceError(
            400,
            'Only movieId or offerId, showtime, and tickets are accepted.'
        );
    }

    const hasMovieId = value.movieId !== undefined;
    const hasOfferId = value.offerId !== undefined;
    if (hasMovieId === hasOfferId) {
        throw new PricingServiceError(400, 'Provide exactly one of movieId or offerId.');
    }

    let movieId: string | undefined;
    let offerId: string | undefined;
    if (hasMovieId) {
        const rawMovieId = value.movieId;
        movieId =
            typeof rawMovieId === 'number' && Number.isSafeInteger(rawMovieId)
                ? String(rawMovieId)
                : typeof rawMovieId === 'string'
                  ? rawMovieId
                  : undefined;
        if (!movieId || !/^\d+$/.test(movieId)) {
            throw new PricingServiceError(400, 'movieId must be a numeric movie ID.');
        }
    } else if (typeof value.offerId === 'string' && value.offerId.trim()) {
        offerId = value.offerId.trim();
    } else {
        throw new PricingServiceError(400, 'offerId must be a non-empty string.');
    }

    if (!isRecord(value.showtime)) {
        throw new PricingServiceError(400, 'showtime with day and time is required.');
    }

    const { day, time } = value.showtime;
    if (Object.keys(value.showtime).some((key) => !['day', 'time'].includes(key))) {
        throw new PricingServiceError(400, 'showtime only accepts day and time.');
    }
    if (
        typeof day !== 'string' ||
        !DAYS.includes(day) ||
        typeof time !== 'string' ||
        !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)
    ) {
        throw new PricingServiceError(
            400,
            'showtime.day must be a weekday name and showtime.time must use HH:mm.'
        );
    }

    return { movieId, offerId, showtime: { day, time } };
}

async function getMovie(movieId: string, requireVisible = true): Promise<MovieRecord> {
    const result = await docClient.send(
        new QueryCommand({
            TableName: requiredTableName('TABLE_NAME'),
            KeyConditionExpression: 'tmdbId = :tmdbId',
            ExpressionAttributeValues: { ':tmdbId': movieId },
            Limit: 2,
            ConsistentRead: true,
        })
    );
    const items = result.Items ?? [];
    if (items.length > 1) {
        throw new PricingServiceError(409, 'Multiple movie records match this ID.');
    }
    const movie = items[0];
    if (!movie) {
        throw new PricingServiceError(404, 'Active movie not found.');
    }
    if (!isMovieRecord(movie)) throw new Error('DynamoDB returned an invalid movie record.');
    if (requireVisible && !movie.visible) {
        throw new PricingServiceError(404, 'Active movie not found.');
    }
    return movie;
}

async function getOffer(offerId: string): Promise<OfferRecord> {
    const result = await docClient.send(
        new GetCommand({
            TableName: requiredTableName('OFFERS_TABLE_NAME'),
            Key: { offerId },
            ConsistentRead: true,
        })
    );
    if (!result.Item) {
        throw new PricingServiceError(404, 'Active offer not found.');
    }
    if (!isOfferRecord(result.Item)) throw new Error('DynamoDB returned an invalid offer record.');
    if (!result.Item.isActive) throw new PricingServiceError(404, 'Active offer not found.');
    return result.Item;
}

async function getPricing(pricingId: string): Promise<PricingRecord> {
    const result = await docClient.send(
        new GetCommand({
            TableName: requiredTableName('PRICING_TABLE_NAME'),
            Key: { pricingId },
            ConsistentRead: true,
        })
    );
    if (!isPricingRecord(result.Item)) {
        throw new Error(`Pricing record ${pricingId} is missing or invalid.`);
    }
    return result.Item;
}

function validateScheduledTime(
    movie: MovieRecord,
    offer: OfferRecord | undefined,
    showtime: ShowtimeSelection
): void {
    const schedule = offer?.overrideShowtimes ?? movie.showtimes;
    if (!schedule[showtime.day]?.includes(showtime.time)) {
        throw new PricingServiceError(400, 'The selected showtime is not available.');
    }
}

function standardPricingId(showtime: ShowtimeSelection): string {
    if (showtime.day === 'Tuesday') return 'CRAZY_TUESDAY_RATES';

    const isWeekday = DAYS.slice(0, 5).includes(showtime.day);
    return isWeekday && showtime.time < '17:00' ? 'OFF_PEAK_RATES' : 'STANDARD_RATES';
}

export async function resolvePricing(value: unknown): Promise<ResolvedPricing> {
    const request = parseSelection(value);
    const offer = request.offerId ? await getOffer(request.offerId) : undefined;
    const movieId = offer?.featuredMovieId ?? request.movieId!;
    const movie = await getMovie(movieId, !offer);
    validateScheduledTime(movie, offer, request.showtime);

    const pricingId = offer?.pricingId ?? standardPricingId(request.showtime);
    const pricing = await getPricing(pricingId);
    return {
        movieId,
        movieTitle: movie.title,
        ...(offer && { offerId: offer.offerId, offerTitle: offer.title }),
        showtime: request.showtime,
        pricing,
    };
}

function parseTicketRequest(value: unknown): TicketRequest[] {
    if (!Array.isArray(value) || value.length === 0) {
        throw new PricingServiceError(400, 'tickets must be a non-empty array.');
    }

    const seen = new Set<string>();
    return value.map((ticket) => {
        if (!isRecord(ticket)) {
            throw new PricingServiceError(
                400,
                'Each ticket must include a tierId and a positive integer quantity.'
            );
        }
        if (Object.keys(ticket).some((key) => !['tierId', 'quantity'].includes(key))) {
            throw new PricingServiceError(400, 'Ticket items only accept tierId and quantity.');
        }
        if (
            typeof ticket.tierId !== 'string' ||
            !ticket.tierId.trim() ||
            !Number.isSafeInteger(ticket.quantity) ||
            (ticket.quantity as number) < 1
        ) {
            throw new PricingServiceError(
                400,
                'Each ticket must include a tierId and a positive integer quantity.'
            );
        }
        const tierId = ticket.tierId.trim();
        if (seen.has(tierId)) {
            throw new PricingServiceError(400, `Ticket tier ${tierId} was provided more than once.`);
        }
        seen.add(tierId);
        return { tierId, quantity: ticket.quantity as number };
    });
}

export async function validateCheckout(value: unknown): Promise<{
    movieId: string;
    movieTitle: string;
    offerId?: string;
    offerTitle?: string;
    pricingId: string;
    pricingName: string;
    currency: 'GBP';
    showtime: ShowtimeSelection;
    tickets: Array<TicketRequest & { label: string; unitPrice: number; subtotal: number }>;
    total: number;
}> {
    if (!isRecord(value)) {
        throw new PricingServiceError(400, 'A JSON request object is required.');
    }

    if (
        Object.keys(value).some(
            (key) => !['movieId', 'offerId', 'showtime', 'tickets'].includes(key)
        )
    ) {
        throw new PricingServiceError(
            400,
            'Only movieId or offerId, showtime, and tickets are accepted.'
        );
    }
    const tickets = parseTicketRequest(value.tickets);
    const selected = await resolvePricing(value);
    const tiers = new Map(selected.pricing.ticketTiers.map((tier) => [tier.id, tier]));
    let totalPence = 0;
    const pricedTickets = tickets.map((ticket) => {
        const tier = tiers.get(ticket.tierId);
        if (!tier) {
            throw new PricingServiceError(400, `Unknown ticket tier: ${ticket.tierId}.`);
        }
        const unitPricePence = Math.round(tier.price * 100);
        const subtotalPence = unitPricePence * ticket.quantity;
        if (!Number.isSafeInteger(subtotalPence) || !Number.isSafeInteger(totalPence + subtotalPence)) {
            throw new PricingServiceError(400, 'The requested checkout total is too large.');
        }
        totalPence += subtotalPence;
        return {
            ...ticket,
            label: tier.label,
            unitPrice: unitPricePence / 100,
            subtotal: subtotalPence / 100,
        };
    });

    return {
        movieId: selected.movieId,
        movieTitle: selected.movieTitle,
        ...(selected.offerId && { offerId: selected.offerId, offerTitle: selected.offerTitle }),
        pricingId: selected.pricing.pricingId,
        pricingName: selected.pricing.name,
        currency: 'GBP',
        showtime: selected.showtime,
        tickets: pricedTickets,
        total: totalPence / 100,
    };
}

export type FilmSelection =
    | {
          type: 'movie';
          id: string;
          movieId: number;
          title: string;
          label: string;
      }
    | {
          type: 'offer';
          id: string;
          offerId: string;
          title: string;
          label: string;
          featuredMovieId: string;
          pricingId: string;
          overrideShowtimes: Record<string, string[]>;
      };

export async function listFilmSelections(): Promise<FilmSelection[]> {
    const tableName = requiredTableName('TABLE_NAME');
    const offersTableName = requiredTableName('OFFERS_TABLE_NAME');
    const movies: MovieRecord[] = [];
    let movieStartKey: DdbKey | undefined;

    do {
        const result = await docClient.send(
            new QueryCommand({
                TableName: tableName,
                IndexName: 'GSI1',
                KeyConditionExpression: 'GSI1PK = :movie',
                ExpressionAttributeValues: { ':movie': 'MOVIE' },
                ExclusiveStartKey: movieStartKey,
            })
        );
        for (const item of result.Items ?? []) {
            if (!isMovieRecord(item)) {
                throw new Error('DynamoDB returned an invalid movie record.');
            }
            if (item.visible) movies.push(item);
        }
        movieStartKey = result.LastEvaluatedKey;
    } while (movieStartKey);

    const offers: OfferRecord[] = [];
    let offerStartKey: DdbKey | undefined;
    do {
        const result = await docClient.send(
            new ScanCommand({
                TableName: offersTableName,
                ExclusiveStartKey: offerStartKey,
            })
        );
        for (const item of result.Items ?? []) {
            if (!isOfferRecord(item)) {
                throw new Error('DynamoDB returned an invalid offer record.');
            }
            if (item.isActive) offers.push(item);
        }
        offerStartKey = result.LastEvaluatedKey;
    } while (offerStartKey);

    const selections: FilmSelection[] = movies.map((movie) => ({
        type: 'movie',
        id: movie.tmdbId,
        movieId: Number(movie.tmdbId),
        title: movie.title,
        label: movie.title,
    }));
    for (const offer of offers) {
        selections.push({
            type: 'offer',
            id: offer.offerId,
            offerId: offer.offerId,
            title: offer.title,
            label: offer.displayLabel ?? `OFFER ${offer.title}`,
            featuredMovieId: offer.featuredMovieId,
            pricingId: offer.pricingId,
            overrideShowtimes: offer.overrideShowtimes ?? {},
        });
    }

    return selections.sort((left, right) => left.label.localeCompare(right.label));
}
