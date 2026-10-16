export interface OfferRecord {
    offerId: string;
    title: string;
    tagline: string;
    priceDescription: string;
    ctaLabel: string;
    featuredMovieId: string;
    pricingId: string;
    isActive: boolean;
    overrideShowtimes?: Record<string, string[]>;
    displayLabel?: string;
}
