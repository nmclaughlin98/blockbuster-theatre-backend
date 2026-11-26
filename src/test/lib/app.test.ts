import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

jest.mock('../../../lib/auth', () => ({
    AuthStack: class extends jest.requireActual<typeof import('aws-cdk-lib')>('aws-cdk-lib').Stack {},
}));

jest.mock('../../../lib/backend', () => ({
    BackendStack: class extends jest.requireActual<typeof import('aws-cdk-lib')>('aws-cdk-lib').Stack {},
}));

describe('CDK app output', () => {
    it.each(['dev', 'prod'])('writes the %s assembly to CDK_OUTDIR', async (environment) => {
        const directory = mkdtempSync(join(tmpdir(), 'cdk-app-test-'));
        const previousOutdir = process.env.CDK_OUTDIR;
        const previousContext = process.env.CDK_CONTEXT_JSON;

        try {
            process.env.CDK_OUTDIR = directory;
            process.env.CDK_CONTEXT_JSON = JSON.stringify({ env: environment });
            await jest.isolateModulesAsync(async () => {
                await import('../../../bin/app');
            });

            const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
            expect(manifest.artifacts[`BlockbusterTheatreBackendStack-${environment}`].type).toBe(
                'aws:cloudformation:stack',
            );
        } finally {
            if (previousOutdir === undefined) {
                delete process.env.CDK_OUTDIR;
            } else {
                process.env.CDK_OUTDIR = previousOutdir;
            }

            if (previousContext === undefined) {
                delete process.env.CDK_CONTEXT_JSON;
            } else {
                process.env.CDK_CONTEXT_JSON = previousContext;
            }

            rmSync(directory, { recursive: true, force: true });
        }
    });
});
