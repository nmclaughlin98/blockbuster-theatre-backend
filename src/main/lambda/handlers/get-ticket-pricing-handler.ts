import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { PricingServiceError, resolvePricing } from './pricing-service';
import { json, log } from './utils';

export const handler = async (
    event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
    const requestId = event.requestContext?.requestId;
    const query = event.queryStringParameters ?? {};

    try {
        const resolved = await resolvePricing({
            movieId: query.movieId,
            offerId: query.offerId,
            showtime: {
                day: query.day,
                time: query.time,
            },
        });
        return json(200, {
            movieId: resolved.movieId,
            movieTitle: resolved.movieTitle,
            ...(resolved.offerId && {
                offerId: resolved.offerId,
                offerTitle: resolved.offerTitle,
            }),
            showtime: resolved.showtime,
            pricing: {
                pricingId: resolved.pricing.pricingId,
                name: resolved.pricing.name,
                currency: resolved.pricing.currency,
                ticketTiers: resolved.pricing.ticketTiers,
            },
        });
    } catch (error: unknown) {
        if (error instanceof PricingServiceError) {
            if (error.statusCode >= 500) {
                log('ERROR', 'Failed to resolve ticket pricing', {
                    requestId,
                    error: error.message,
                });
            }
            return json(error.statusCode, { message: error.message });
        }
        log('ERROR', 'Failed to resolve ticket pricing', {
            requestId,
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        return json(500, { message: 'Unable to resolve ticket pricing.' });
    }
};
