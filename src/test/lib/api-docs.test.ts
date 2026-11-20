import { spawnSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const { createSpec } = require('../../../scripts/api-spec.cjs');
const { handler } = require('../../../build/api-docs/prod/index.cjs');

describe('API reference', () => {
    it('serves the generated HTML and downloadable OpenAPI without authentication', async () => {
        const html = await handler({ rawPath: '/api-docs' });
        expect(html.statusCode).toBe(200);
        expect(html.headers['content-type']).toContain('text/html');
        expect(html.body).toContain('Blockbuster Theatre API');
        expect(Buffer.byteLength(JSON.stringify(html))).toBeLessThan(5_500_000);

        const download = await handler({ rawPath: '/api-docs/openapi.json' });
        expect(download.statusCode).toBe(200);
        expect(download.headers['content-disposition']).toContain('attachment');
        expect(JSON.parse(download.body)).toEqual(createSpec('prod'));
        expect((await handler({ rawPath: '/unexpected' })).statusCode).toBe(404);
        const dev = require('../../../build/api-docs/dev/index.cjs');
        const devSpec = await dev.handler({ rawPath: '/api-docs/openapi.json' });
        expect(JSON.parse(devSpec.body)).toEqual(createSpec('dev'));
    });

    it('selects the environment server and documents public and JWT routes', () => {
        const spec = createSpec('dev');
        expect(spec.openapi).toBe('3.0.3');
        expect(spec.servers[0].url).toBe('https://api-dev.blockbuster-theatre.nml-applications.com');
        expect(spec.paths['/movies'].get.security).toEqual([]);
        expect(spec.paths['/movies'].post.security).toEqual([{ CognitoJwt: [] }]);
        expect(spec.paths['/api/v1/bookings/guest'].post.requestBody.content['application/json'].schema.required)
            .toContain('tickets');
        expect(() => createSpec('other')).toThrow();
    });

    it('rejects undocumented routes and authorization drift', () => {
        const directory = mkdtempSync(join(tmpdir(), 'api-docs-test-'));
        try {
            const resources: Record<string, { Type: string; Properties: { RouteKey: string; AuthorizationType: string } }> = {};
            let index = 0;
            const spec = createSpec(process.env.DOCS_ENV || 'prod');
            for (const [path, methods] of Object.entries(spec.paths) as [string, Record<string, { security: unknown[] }>][]) {
                for (const [method, operation] of Object.entries(methods)) {
                    resources[`route${index++}`] = {
                        Type: 'AWS::ApiGatewayV2::Route',
                        Properties: { RouteKey: `${method.toUpperCase()} ${path}`, AuthorizationType: operation.security.length ? 'JWT' : 'NONE' },
                    };
                }
            }
            for (const path of ['/api-docs', '/api-docs/openapi.json']) {
                resources[`route${index++}`] = { Type: 'AWS::ApiGatewayV2::Route', Properties: { RouteKey: `GET ${path}`, AuthorizationType: 'NONE' } };
            }
            const templatePath = join(directory, 'template.json');
            const check = () => {
                writeFileSync(templatePath, JSON.stringify({ Resources: resources }));
                return spawnSync(process.execPath, ['scripts/check-api-docs.cjs', templatePath], { encoding: 'utf8' });
            };
            expect(check().status).toBe(0);
            resources.extra = { Type: 'AWS::ApiGatewayV2::Route', Properties: { RouteKey: 'GET /undocumented', AuthorizationType: 'NONE' } };
            expect(check().status).not.toBe(0);
            delete resources.extra;
            const movies = Object.values(resources).find((resource) => resource.Properties.RouteKey === 'POST /movies');
            if (!movies) throw new Error('POST /movies not found');
            movies.Properties.AuthorizationType = 'NONE';
            const mismatch = check();
            expect(mismatch.status).not.toBe(0);
            expect(mismatch.stderr).toContain('expected JWT');
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });
});
