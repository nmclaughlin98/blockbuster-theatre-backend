import { parseEnvironmentName, resourceName } from '../../../lib/shared';

describe('CDK environment helpers', () => {
    it('defaults to prod and inserts the environment after the project prefix', () => {
        expect(parseEnvironmentName(undefined)).toBe('prod');
        expect(resourceName('blockbuster-theatre-api-gateway', 'prod'))
            .toBe('blockbuster-theatre-prod-api-gateway');
        expect(resourceName('/aws/vendedlogs/blockbuster-theatre-api-access', 'prod'))
            .toBe('/aws/vendedlogs/blockbuster-theatre-prod-api-access');
    });

    it('inserts the dev environment after the project prefix and rejects unsupported environments', () => {
        expect(parseEnvironmentName('dev')).toBe('dev');
        expect(resourceName('blockbuster-theatre-api-gateway', 'dev'))
            .toBe('blockbuster-theatre-dev-api-gateway');
        expect(resourceName('/blockbuster-theatre/booking-configuration/max-tickets-value', 'dev'))
            .toBe('/blockbuster-theatre-dev/booking-configuration/max-tickets-value');
        expect(() => parseEnvironmentName('staging')).toThrow(
            'Unsupported CDK environment "staging"; expected "prod" or "dev".'
        );
    });
});
