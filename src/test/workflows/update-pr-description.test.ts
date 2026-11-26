import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

describe('update pull request description workflow', () => {
    it('checks out the trusted workflow revision containing the update script', () => {
        const workflow = readFileSync(
            join(process.cwd(), '.github/workflows/update-pr-description.yml'),
            'utf8',
        );

        expect(workflow).toContain('pull_request_target:');
        expect(workflow).toContain('ref: ${{ github.workflow_sha }}');
        expect(workflow).toContain('persist-credentials: false');
        expect(workflow).toContain('node .github/scripts/update-pr-body.cjs');
        expect(existsSync(join(process.cwd(), '.github/scripts/update-pr-body.cjs'))).toBe(true);
    });
});
