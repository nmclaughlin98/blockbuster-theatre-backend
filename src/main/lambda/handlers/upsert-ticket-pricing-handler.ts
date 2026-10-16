import type { PricingRecord } from './interfaces';
import { isPricingRecord } from './pricing-service';
import { createBulkUpsertHandler } from './bulk-upsert-handler';

export const handler = createBulkUpsertHandler<PricingRecord>({
    tableEnvironmentVariable: 'PRICING_TABLE_NAME',
    collectionName: 'pricing',
    idField: 'pricingId',
    entityName: 'ticket pricing packages',
    isRecord: isPricingRecord,
    getId: (pricing) => pricing.pricingId,
    toItem: (pricing) => ({
        pricingId: pricing.pricingId,
        name: pricing.name,
        currency: pricing.currency,
        ticketTiers: pricing.ticketTiers.map((tier) => ({
            id: tier.id,
            label: tier.label,
            description: tier.description,
            price: tier.price,
        })),
    }),
});
