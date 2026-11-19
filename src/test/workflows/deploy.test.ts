import { spawnSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('deploy build artifact selection', () => {
    let directory: string;
    let script: string;

    beforeEach(() => {
        directory = mkdtempSync(join(tmpdir(), 'deploy-test-'));
        const workflow = readFileSync(join(process.cwd(), '.github/workflows/deploy.yml'), 'utf8')
            .replace(/\r\n/g, '\n');
        const step = workflow.split('      - name: Download Build Artifact\n')[1]
            .split('      - name: Configure AWS Credentials\n')[0];
        script = step.split('        run: |\n')[1]
            .replace(/^          /gm, '');
    });

    afterEach(() => {
        rmSync(directory, { recursive: true, force: true });
    });

    function runStep(buildInfo: string, env: Record<string, string> = {}) {
        return spawnSync('bash', ['-e', '-c', `
            gh() {
                echo "$*" >> "$CALLS"
                if [ "$1 $2" = "run list" ]; then
                    printf '%s' "$BUILD_INFO"
                fi
            }
            ${script}
        `], {
            encoding: 'utf8',
            env: {
                ...process.env,
                GITHUB_EVENT_NAME: 'workflow_dispatch',
                DISPATCH_BRANCH: 'environment-control',
                DISPATCH_REF_TYPE: 'branch',
                GITHUB_OUTPUT: join(directory, 'output'),
                GITHUB_STEP_SUMMARY: join(directory, 'summary'),
                CALLS: join(directory, 'calls'),
                BUILD_INFO: buildInfo,
                ...env,
            },
        });
    }

    it('rejects an empty latest build lookup without downloading an artifact', () => {
        const result = runStep('');
        expect(result.status).toBe(1);
        expect(result.stdout).toContain('No successful build found');
        const calls = readFileSync(join(directory, 'calls'), 'utf8');
        expect(calls).toContain('--jq .[] | [.databaseId, .number] | @tsv');
        expect(calls).not.toContain('run download');
    });

    it('rejects a whitespace-only lookup result', () => {
        const result = runStep('\t');
        expect(result.status).toBe(1);
        expect(result.stdout).toContain('No successful build found');
        expect(readFileSync(join(directory, 'calls'), 'utf8')).not.toContain('run download');
    });

    it('downloads the selected successful build', () => {
        const result = runStep('12345\t42');
        expect(result.status).toBe(0);
        const calls = readFileSync(join(directory, 'calls'), 'utf8');
        expect(calls).toContain('--branch environment-control --status success --limit 1');
        expect(calls).toContain('run download 12345 --name build-artifact-42-dev --dir cdk-out');
        expect(readFileSync(join(directory, 'output'), 'utf8'))
            .toContain('build_number=42\nbuild_run_id=12345\ndeploy_environment=dev\ndeploy_branch=environment-control');
    });

    it('downloads a specific production build', () => {
        const result = runStep('23456\t17', {
            INPUT_ENVIRONMENT: 'prod', INPUT_BUILD_NUMBER: '17', DISPATCH_BRANCH: 'main',
        });
        expect(result.status).toBe(0);
        const calls = readFileSync(join(directory, 'calls'), 'utf8');
        expect(calls).toContain('--branch main --status success --limit 100');
        expect(calls).toContain('select(.number == 17)');
        expect(calls).toContain('run download 23456 --name build-artifact-17-prod --dir cdk-out');
        expect(readFileSync(join(directory, 'output'), 'utf8'))
            .toContain('build_number=17\nbuild_run_id=23456\ndeploy_environment=prod\ndeploy_branch=main');
    });

    it('rejects a missing numbered build and preserves workflow-run downloads', () => {
        const missing = runStep('', { INPUT_BUILD_NUMBER: '42' });
        expect(missing.status).toBe(1);
        expect(missing.stdout).toContain('No successful build found');

        const triggered = runStep('', {
            GITHUB_EVENT_NAME: 'workflow_run',
            TRIGGER_RUN_ID: '67890',
            TRIGGER_RUN_NUMBER: '43',
            TRIGGER_HEAD_BRANCH: 'dev',
        });
        expect(triggered.status).toBe(0);
        expect(readFileSync(join(directory, 'calls'), 'utf8'))
            .toContain('run download 67890 --name build-artifact-43-dev --dir cdk-out');
    });

    it('uses the production artifact for a successful main workflow run', () => {
        const result = runStep('', {
            GITHUB_EVENT_NAME: 'workflow_run',
            TRIGGER_RUN_ID: '67890',
            TRIGGER_RUN_NUMBER: '43',
            TRIGGER_HEAD_BRANCH: 'main',
        });
        expect(result.status).toBe(0);
        expect(readFileSync(join(directory, 'calls'), 'utf8'))
            .toContain('run download 67890 --name build-artifact-43-prod --dir cdk-out');
        expect(readFileSync(join(directory, 'output'), 'utf8'))
            .toContain('deploy_environment=prod\ndeploy_branch=main');
    });

    it('rejects dispatches from tags', () => {
        const result = runStep('12345\t42', { DISPATCH_REF_TYPE: 'tag' });
        expect(result.status).toBe(1);
        expect(result.stdout).toContain('Select a branch to deploy');
    });

    it('synthesizes and uploads separate environment artifacts', () => {
        const workflow = readFileSync(join(process.cwd(), '.github/workflows/build.yml'), 'utf8')
            .replace(/\r\n/g, '\n');
        const synth = workflow.split('      - name: Synthesize CDK App\n')[1]
            .split('      - name: Upload Dev Build Artifact\n')[0]
            .split('        run: |\n')[1].replace(/^          /gm, '');
        const result = spawnSync('bash', ['-e', '-c', `
            npx() { echo "$*" >> "$CALLS"; }
            ${synth}
        `], { encoding: 'utf8', env: { ...process.env, CALLS: join(directory, 'calls') } });

        expect(result.status).toBe(0);
        expect(readFileSync(join(directory, 'calls'), 'utf8')).toBe(
            'cdk synth -c env=dev --output cdk-out/dev\n' +
            'cdk synth -c env=prod --output cdk-out/prod\n'
        );
        expect(workflow).toContain('name: build-artifact-${{ github.run_number }}-dev\n          path: cdk-out/dev');
        expect(workflow).toContain('name: build-artifact-${{ github.run_number }}-prod\n          path: cdk-out/prod');
    });
});
