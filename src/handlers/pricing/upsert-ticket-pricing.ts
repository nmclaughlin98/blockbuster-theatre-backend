import type { PricingRecord } from '../../main/lambda/lib/interfaces';
import { isPricingRecord } from '../../services/checkout/pricing-service';
import { createBulkUpsertHandler } from '../../main/lambda/handlers/Shared/bulk-upsert-handler';

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
