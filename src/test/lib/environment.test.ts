import { parseEnvironmentName, resourceName } from '../../../lib/stack/environment';

describe('CDK environment helpers', () => {
    it('defaults to prod and preserves existing physical names', () => {
        expect(parseEnvironmentName(undefined)).toBe('prod');
        expect(resourceName('blockbuster-theatre-api-gateway', 'prod'))
            .toBe('blockbuster-theatre-api-gateway');
    });

    it('adds the dev suffix and rejects unsupported environments', () => {
        expect(parseEnvironmentName('dev')).toBe('dev');
        expect(resourceName('blockbuster-theatre-api-gateway', 'dev'))
            .toBe('blockbuster-theatre-api-gateway-dev');
        expect(() => parseEnvironmentName('staging')).toThrow(
            'Unsupported CDK environment "staging"; expected "prod" or "dev".'
        );
    });
});
