import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPullRequestBody, formatTesting } from '../../../.github/scripts/update-pr-body.cjs';

const template = readFileSync(join(process.cwd(), '.github/pull_request_template.md'), 'utf8')
    .replace(/\r\n/g, '\n');

describe('pull request body generation', () => {
    it('puts generated commit summaries in Summary and removes content before Date', () => {
        const body = buildPullRequestBody(
            `.github/workflows/deploy.yml\n- Generated details\n\n${template}`,
            [{
                sha: '0f840f9abcdef',
                commit: { message: 'FIX: Corrected stack name in deploy script\n\nMore details' },
            }],
            '2026-11-26T00:00:00Z',
        );

        expect(body).toMatch(/^## Date/m);
        expect(body).not.toMatch(/^\.github\/workflows\/deploy\.yml/m);
        expect(body).toContain('- `0f840f9` FIX: Corrected stack name in deploy script');
        expect(body).toContain(
            '<!-- pr-summary:start -->\n- FIX: Corrected stack name in deploy script\n<!-- pr-summary:end -->',
        );
        expect(body).toContain('CI results will be updated when the build workflow completes.');
    });

    it('renders build command outcomes in the Testing section', () => {
        expect(formatTesting([{
            steps: [
                { name: 'Check TypeScript Compilation', conclusion: 'failure' },
                { name: 'Synthesize CDK App (dev)', conclusion: 'success' },
                { name: 'Synthesize CDK App (prod)', conclusion: 'success' },
            ],
        }])).toBe([
            '- `npm test` — not run in the build workflow',
            '- `npm run build` — failure',
            '- `npx cdk synth -c env=dev --output cdk-out/dev` — passed',
            '- `npx cdk synth -c env=prod --output cdk-out/prod` — passed',
        ].join('\n'));
    });
});
