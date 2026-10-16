import type { OfferRecord } from './interfaces';
import { isOfferRecord } from './pricing-service';
import { createBulkUpsertHandler } from './bulk-upsert-handler';

export const handler = createBulkUpsertHandler<OfferRecord>({
    tableEnvironmentVariable: 'OFFERS_TABLE_NAME',
    collectionName: 'offers',
    idField: 'offerId',
    entityName: 'booking offers',
    isRecord: isOfferRecord,
    getId: (offer) => offer.offerId,
    toItem: (offer) => ({
        offerId: offer.offerId,
        title: offer.title,
        tagline: offer.tagline,
        priceDescription: offer.priceDescription,
        ctaLabel: offer.ctaLabel,
        featuredMovieId: offer.featuredMovieId,
        pricingId: offer.pricingId,
        isActive: offer.isActive,
        ...(offer.displayLabel !== undefined && { displayLabel: offer.displayLabel }),
        ...(offer.overrideShowtimes !== undefined && {
            overrideShowtimes: offer.overrideShowtimes,
        }),
    }),
});
