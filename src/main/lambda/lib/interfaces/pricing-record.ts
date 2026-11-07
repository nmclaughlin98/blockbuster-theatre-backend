export interface PricingTier {
    id: string;
    label: string;
    description: string;
    price: number;
}

export interface PricingRecord {
    pricingId: string;
    name: string;
    currency: 'GBP';
    ticketTiers: PricingTier[];
}
