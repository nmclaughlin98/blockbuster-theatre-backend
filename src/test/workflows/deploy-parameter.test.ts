import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('deploy TMDB parameter', () => {
    const workflow = readFileSync(join(process.cwd(), '.github/workflows/deploy.yml'), 'utf8')
        .replace(/\r\n/g, '\n');
    const step = workflow.split('      - name: Deploy CDK stack\n')[1];
    const script = step.split('        run: |\n')[1].replace(/^          /gm, '');

    function deploy(targetEnv: string, targetStack: string, key: string) {
        return spawnSync('bash', ['-e', '-c', `
            npx() { printf 'ARG:%s\\n' "$@"; }
            ${script}
        `], {
            encoding: 'utf8',
            env: { ...process.env, TARGET_ENV: targetEnv, TARGET_STACK: targetStack, TMDB_API_KEY: key },
        });
    }

    it('reads the key from Actions secrets', () => {
        expect(step).toContain('TMDB_API_KEY: ${{ secrets.TMDB_API_KEY }}');
    });

    it.each(['dev', 'prod'])('passes the parameter to the %s backend stack', environment => {
        const result = deploy(environment, 'backend', 'key with spaces');
        expect(result.status).toBe(0);
        expect(result.stdout).toContain(`ARG:BlockbusterTheatreBackendStack-${environment}\n`);
        expect(result.stdout).toContain(`ARG:BlockbusterTheatreBackendStack-${environment}:TmdbApiKey=key with spaces\n`);
    });

    it.each(['both', 'all'])('scopes the parameter to the backend for %s deployments', stack => {
        const result = deploy('prod', stack, 'test-key');
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('ARG:--all\n');
        expect(result.stdout).toContain('ARG:BlockbusterTheatreBackendStack-prod:TmdbApiKey=test-key\n');
    });

    it.each(['', ' \t '])('rejects a missing or blank backend key', key => {
        const result = deploy('prod', 'backend', key);
        expect(result.status).not.toBe(0);
        expect(result.stdout).toContain('TMDB_API_KEY must be configured');
        expect(result.stdout).not.toContain('ARG:');
    });

    it('does not require or pass the key for auth-only deployments', () => {
        const result = deploy('prod', 'auth', '');
        expect(result.status).toBe(0);
        expect(result.stdout).not.toContain('ARG:--parameters');
    });
});
