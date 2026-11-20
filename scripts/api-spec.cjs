'use strict';

// HTTP API Lambda proxy integrations do not define application models in API Gateway.
// Keep this contract in sync with handler validation and response shapes.
const str = { type: 'string' };
const num = { type: 'number' };
const bool = { type: 'boolean' };
const date = { type: 'string', format: 'date' };
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const array = (items) => ({ type: 'array', items });
const object = (properties, required = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}) });
const query = (name, required = false, schema = str, description) => ({
    name, in: 'query', required, schema, ...(description ? { description } : {}),
});
const pathParam = (name) => ({ name, in: 'path', required: true, schema: str });
const json = (schema) => ({ 'application/json': { schema } });
const body = (schema) => ({ required: true, content: json(schema) });
const response = (description, schema) => ({ description, ...(schema ? { content: json(schema) } : {}) });
const strings = array(str);
const ticket = object({ tierId: str, quantity: { type: 'integer', minimum: 1 } }, ['tierId', 'quantity']);
const showtime = object({ day: str, time: str, screen: str }, ['day', 'time']);
const movie = object({
    movieId: { type: 'integer' }, title: str, slug: str, sortTitle: str, visible: bool,
    isComingSoon: bool, lifecycleStatus: str, isCarousel: bool, trailer: str, still: str,
    synopsis: str, tagline: str, poster: str, rating: str, runtime: num, genres: strings,
    mainGenre: str, releaseDate: str, startDate: date, runEndDate: date, starring: strings, director: str,
    preSalesEligible: bool, score: num,
    showtimes: { type: 'object', additionalProperties: array(object({ showtimeId: str, screen: str, time: str })) },
});
const pricing = object({
    pricingId: str, name: str, currency: { type: 'string', enum: ['GBP'] },
    ticketTiers: array(object({ id: str, label: str, description: str, price: num }, ['id', 'label', 'description', 'price'])),
}, ['pricingId', 'name', 'currency', 'ticketTiers']);
const offer = object({
    offerId: str, title: str, tagline: str, priceDescription: str, ctaLabel: str,
    featuredMovieId: str, pricingId: str, isActive: bool, displayLabel: str,
    overrideShowtimes: { type: 'object', additionalProperties: array(object({ screen: str, time: str }, ['screen', 'time'])) },
}, ['offerId', 'title', 'tagline', 'priceDescription', 'ctaLabel', 'featuredMovieId', 'pricingId', 'isActive']);
const selection = { movieId: str, offerId: str, date, showtime, tickets: array(ticket) };
const guestRequest = object({
    showtimeId: str, date, seats: strings, email: { type: 'string', format: 'email' },
    customerName: str, tickets: array(ticket), offerId: str,
}, ['showtimeId', 'date', 'seats', 'email', 'customerName', 'tickets']);
const booking = object({
    bookingId: str, bookingRef: str, movieId: str, movieTitle: str, showtimeId: str,
    date, seats: strings, tickets: array(object({ tierId: str, label: str, quantity: num, unitPrice: num, subtotal: num })),
    totalAmount: num, currency: str, customerEmail: str, confirmationEmailSent: bool,
    conversionToken: str, conversionTokenExpiresAt: { type: 'string', format: 'date-time' },
    time: str, screen: str, guestName: str, ticketCount: num,
});
const collection = object({
    collectionId: str, name: str, description: str, posterUrl: str, backdropUrl: str,
    isActive: bool, movieCount: { type: 'integer' }, movieIds: strings, lastUpdated: str,
});
const rawMovie = object({
    tmdbId: str, slug: str, sortTitle: str, title: str, visible: bool, isComingSoon: bool,
    isCarousel: bool, genres: strings, mainGenre: str, rating: str, score: num,
    runtime: num, releaseDate: str, startDate: date, runEndDate: date, preSalesEligible: bool,
    poster: str, still: str, starring: strings, director: str, synopsis: str, tagline: str, trailer: str,
});
const filmSelection = {
    oneOf: [
        object({ type: { type: 'string', enum: ['movie'] }, id: str, movieId: { type: 'integer' }, title: str, label: str }, ['type', 'id', 'movieId', 'title', 'label']),
        object({ type: { type: 'string', enum: ['offer'] }, id: str, offerId: str, title: str, label: str, tagline: str, priceDescription: str, ctaLabel: str, displayLabel: str, featuredMovieId: str, pricingId: str, overrideShowtimes: offer.properties.overrideShowtimes }, ['type', 'id', 'offerId', 'title', 'label']),
    ],
};
const page = object({ movies: array(ref('Movie')), nextToken: { type: 'string', nullable: true } });
const batch = object({
    message: str, summary: object({ total: num, successCount: num, failedCount: num, dedupedFrom: num }),
    successful: array(object({ id: str, status: str, title: str })),
    failed: array(object({ id: str, status: str, error: str })),
});
const bulkResult = object({ message: str, count: num, ids: strings });
const schemas = {
    Movie: movie, Pricing: pricing, Offer: offer, Booking: booking,
    Error: object({ message: str, requestId: str }),
};

function operation(summary, options = {}) {
    const { secure, parameters, request, status = '200', result, description, responses = {} } = options;
    return {
        summary,
        description: description || summary + '.',
        security: secure ? [{ CognitoJwt: [] }] : [],
        ...(parameters?.length ? { parameters } : {}),
        ...(request ? { requestBody: body(request) } : {}),
        responses: {
            [status]: response('Successful response', result),
            ...responses,
            '400': response('Invalid request', ref('Error')),
            ...(secure ? { '401': { description: 'Missing or invalid Cognito JWT' } } : {}),
            '500': response('Server error', ref('Error')),
        },
    };
}
const pagination = [
    query('limit', false, { type: 'integer', minimum: 1, maximum: 100 }),
    query('nextToken', false, str, 'Opaque token from a previous response.'),
];
const dateParam = query('date', false, date);
const showingQuery = [query('showtimeId', true), query('date', true, date)];
const bookingResponse = object({ showtimeId: str, date, bookedSeats: strings, myBookedSeats: strings });
const schedule = object({ showtimeId: str, previousShowtimeId: str, movieId: str, date, day: str, screen: str, time: str, source: str });
const movieUpdates = object({
    slug: str, sortTitle: str, title: str, visible: bool, isComingSoon: bool, isCarousel: bool,
    genres: strings, rating: str, score: num, runtime: num, releaseDate: str, startDate: date,
    runEndDate: date, preSalesEligible: bool, poster: str, still: str, starring: strings,
    director: str, synopsis: str, trailer: str,
});
movieUpdates.minProperties = 1;
movieUpdates.additionalProperties = false;
const paths = {
    '/film-selections': { get: operation('List film and offer selections', { parameters: [dateParam], result: object({ selections: array(filmSelection) }) }) },
    '/ticket-pricing': {
        get: operation('Resolve ticket pricing', { description: 'Provide exactly one of movieId or offerId with day and time.', parameters: [query('movieId'), query('offerId'), query('day', true), query('time', true), dateParam], result: object({ movieId: str, movieTitle: str, offerId: str, offerTitle: str, showtime, pricing: ref('Pricing') }) }),
        post: operation('Upsert ticket pricing', { secure: true, request: object({ pricing: { ...array(ref('Pricing')), minItems: 1, maxItems: 25 } }, ['pricing']), result: bulkResult }),
    },
    '/booking-offers': { post: operation('Upsert booking offers', { secure: true, request: object({ offers: { ...array(ref('Offer')), minItems: 1, maxItems: 25 } }, ['offers']), result: bulkResult }) },
    '/checkout/validate': { post: operation('Validate and price a checkout', { description: 'Provide exactly one of movieId or offerId. This does not process a payment.', request: object(selection, ['showtime', 'tickets']), result: object({ movieId: str, movieTitle: str, offerId: str, offerTitle: str, pricingId: str, pricingName: str, currency: str, showtime, tickets: array(object({ tierId: str, quantity: num, label: str, unitPrice: num, subtotal: num })), total: num }) }) },
    '/booking/confirmation': { post: operation('Send a demo booking confirmation', { description: 'Sends an email only; does not process payment or create a reservation.', request: object({ bookingRef: str, customer: object({ firstName: str, surname: str, email: str, phone: str }, ['firstName', 'surname', 'email']), movieTitle: str, date: str, time: str, screen: str, seats: strings, tickets: num, totalPrice: num }, ['bookingRef', 'customer', 'movieTitle', 'date', 'time', 'screen', 'seats', 'tickets', 'totalPrice']), result: object({ message: str, bookingRef: str }), responses: { '502': response('Email delivery failed', ref('Error')) } }) },
    '/movies': {
        get: operation('List movies', { description: 'Follow nextToken until null. Invisible movies are excluded.', parameters: pagination, result: page }),
        post: operation('Import movies from TMDB', { secure: true, request: object({ movieIds: { ...array({ oneOf: [str, { type: 'integer' }] }), minItems: 1, maxItems: 100 }, isComingSoon: bool, startDate: date, runEndDate: date, preSalesEligible: bool }, ['movieIds']), result: batch }),
        patch: operation('Update movies', { secure: true, request: object({ movieIds: { ...array({ oneOf: [str, { type: 'integer' }] }), minItems: 1, maxItems: 25 }, updates: movieUpdates }, ['movieIds', 'updates']), result: batch }),
    },
    '/movies/newest': { get: operation('List newest movies', { parameters: [...pagination, dateParam], result: page }) },
    '/movies/top-picks': { get: operation('List top-rated movies', { parameters: [...pagination, dateParam], result: page }) },
    '/movies/{id}': { get: operation('Get a movie', { parameters: [pathParam('id'), dateParam], result: ref('Movie'), responses: { '404': response('Movie not found', ref('Error')) } }) },
    '/movies/export': { get: operation('Export movies', { secure: true, result: object({ movies: array(rawMovie) }) }) },
    '/movies/tmdb-ids': { get: operation('List imported TMDB IDs', { secure: true, result: object({ tmdbIds: strings }) }) },
    '/collections': { get: operation('List movie collections', { result: object({ collections: array(collection) }) }) },
    '/collections/{id}': { get: operation('Get a movie collection', { parameters: [pathParam('id'), dateParam], result: object({ collection, movies: array(ref('Movie')) }), responses: { '404': response('Collection not found', ref('Error')) } }) },
    '/collections/refresh': { post: operation('Refresh TMDB collections', { secure: true, request: object({ ids: { ...array({ oneOf: [str, { type: 'integer' }] }), minItems: 1, maxItems: 25 } }, ['ids']), result: object({ message: str, refreshedCount: num, failedCount: num, results: array(object({ collectionId: str, success: bool, name: str, movieCount: num, lastUpdated: str, statusCode: num, message: str })) }), responses: { '207': response('One or more collections failed', object({ message: str, refreshedCount: num, failedCount: num, results: array({ type: 'object' }) })) } }) },
    '/bookings': {
        get: operation('List booked seats (legacy)', { description: 'Provide showtimeId and date, or movieId, date, day and time.', parameters: [query('showtimeId'), query('movieId'), dateParam, query('day'), query('time')], result: object({ movieId: str, showtimeId: str, date, showtime, bookedSeats: strings }) }),
        post: operation('Create a booking (legacy)', { request: object({ movieId: str, date, showtime, seats: strings, offerId: str }, ['movieId', 'date', 'showtime', 'seats']), status: '201', result: object({ bookingId: str, userId: str, movieId: str, movieTitle: str, date, showtimeId: str, showtime, seats: strings, bookedAt: str }), responses: { '409': response('Seat already booked', ref('Error')) } }),
    },
    '/bookings/reschedule-booking': { patch: operation('Reschedule a booking', { parameters: [query('showtimeId', true), query('bookingRef', true)], request: object({ newShowtimeId: str, date, time: str, screen: str }, ['newShowtimeId']), result: object({ message: str, bookingId: str, bookingRef: str, oldShowtimeId: str, showtimeId: str, date, day: str, time: str, screen: str, seats: strings, updatedAt: str }), responses: { '404': response('Booking not found', ref('Error')), '409': response('Seat unavailable', ref('Error')) } }) },
    '/showtimes': { post: operation('Create a screening', { secure: true, parameters: [query('movieId', true)], request: object({ date, screen: str, time: str }, ['date', 'screen', 'time']), status: '201', result: schedule, responses: { '409': response('Screening conflict', ref('Error')) } }) },
    '/showtimes/{showtimeId}': {
        patch: operation('Update a screening', { secure: true, parameters: [pathParam('showtimeId'), query('movieId', true)], request: object({ date, screen: str, time: str }), result: schedule, responses: { '409': response('Screening conflict or active bookings', ref('Error')) } }),
        delete: operation('Cancel a screening', { secure: true, parameters: [pathParam('showtimeId'), query('movieId', true)], result: object({ showtimeId: str, cancelled: bool }), responses: { '409': response('Screening has active bookings', ref('Error')) } }),
    },
    '/api/v1/bookings/guest': {
        get: operation('List booked seats for a guest', { parameters: showingQuery, result: bookingResponse }),
        post: operation('Create an unpaid guest booking', { description: 'No payment is processed. The date must match showtimeId; ticket quantities must match the seat count.', request: guestRequest, status: '201', result: ref('Booking'), responses: { '404': response('Movie or offer not found', ref('Error')), '409': response('Seat unavailable', ref('Error')) } }),
    },
    '/api/v1/bookings/account': {
        get: operation('List booked seats for an account', { secure: true, description: 'Send a Cognito access token. The response includes seats belonging to the authenticated user.', parameters: showingQuery, result: bookingResponse }),
        post: operation('Create an unpaid account booking', { secure: true, description: 'The Cognito subject identifies the account; do not send userId. No payment is processed.', request: guestRequest, status: '201', result: ref('Booking'), responses: { '404': response('Movie or offer not found', ref('Error')), '409': response('Seat unavailable', ref('Error')) } }),
    },
    '/api/v1/bookings/account/history': { get: operation('List account bookings', { secure: true, description: 'An ID token with a verified email may link guest bookings when enabled; access tokens do not initiate linking.', result: object({ bookings: array(ref('Booking')), newlyLinkedBookings: strings, linkNotificationSent: bool }) }) },
    '/api/v1/auth/convert-guest': { post: operation('Convert a guest booking to an account', { request: object({ conversionToken: str, password: { type: 'string', format: 'password', minLength: 12 }, firstName: str, surname: str }, ['conversionToken', 'password']), result: object({ userId: str, email: str, accessToken: str, refreshToken: str }), responses: { '404': response('Token not found', ref('Error')), '409': response('Token already consumed', ref('Error')), '410': response('Token expired', ref('Error')) } }) },
    '/bookings/{bookingId}/ticket': { get: operation('Download an account ticket', { secure: true, description: 'Send a Cognito access token. The PDF represents an unpaid reservation.', parameters: [pathParam('bookingId')], responses: { '200': { description: 'Unpaid reservation ticket', content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } }, '404': response('Booking not found', ref('Error')) } }) },
};

function createSpec(environment) {
    if (!['prod', 'dev'].includes(environment)) throw new Error('Environment must be prod or dev.');
    for (const [path, methods] of Object.entries(paths)) {
        for (const [method, operation] of Object.entries(methods)) {
            operation.operationId = `${method}_${path.replace(/[{}]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '')}`;
        }
    }
    return {
        openapi: '3.0.3',
        info: {
            title: 'Blockbuster Theatre API',
            version: require('../package.json').version,
            description: 'HTTP API reference. [Download openapi.json](/api-docs/openapi.json). Protected routes require a Cognito JWT in the Authorization header. Both environments use the shared production Cognito pool; the issuer is `https://cognito-idp.eu-west-2.amazonaws.com/{production-user-pool-id}` and the accepted audiences are the frontend and Postman app clients. API Gateway verifies the issuer and audience; no route-specific authorization scopes are configured. Some handlers require a particular token type as described below.',
        },
        servers: [{ url: `https://api${environment === 'dev' ? '-dev' : ''}.blockbuster-theatre.nml-applications.com` }],
        paths,
        components: {
            securitySchemes: { CognitoJwt: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Cognito JWT in the Authorization header. Gateway verifies issuer and audience.' } },
            schemas,
        },
    };
}

module.exports = { createSpec };
