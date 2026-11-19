import { spawnSync } from 'child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('deploy Cognito parameters', () => {
    let directory: string;
    let script: string;

    beforeEach(() => {
        directory = mkdtempSync(join(tmpdir(), 'deploy-cognito-test-'));
        const workflow = readFileSync(join(process.cwd(), '.github/workflows/deploy.yml'), 'utf8')
            .replace(/\r\n/g, '\n');
        const step = workflow.split('      - name: Deploy CDK Stack\n')[1]
            .split('      - name: Write Deploy Summary\n')[0];
        script = step.split('        run: |\n')[1].replace(/^          /gm, '');
        mkdirSync(join(directory, 'cdk-out'));
    });

    afterEach(() => {
        rmSync(directory, { recursive: true, force: true });
    });

    function runStep(
        parameters: Record<string, unknown>,
        outputs: unknown,
        environment = 'dev',
        failAssumeRole = false,
        tmdbApiKey = 'test-deploy-key',
        postmanClientId = 'postmanclientid'
    ) {
        writeFileSync(join(directory, 'cdk-out/BlockbusterTheatreBackendStack-dev.template.json'),
            JSON.stringify({ Parameters: parameters }));
        return spawnSync('bash', ['-e', '-c', `
            aws() {
                echo "$*" >> "$CALLS"
                if [ "$1" = sts ]; then
                    if [ "\${FAIL_ASSUME_ROLE:-false}" = true ]; then return 1; fi
                    printf '%s' '{"Credentials":{"AccessKeyId":"lookup-key","SecretAccessKey":"lookup-secret","SessionToken":"lookup-token"}}'
                else
                    printf '%s\\n' "$AWS_ACCESS_KEY_ID" "$AWS_SECRET_ACCESS_KEY" "$AWS_SESSION_TOKEN" >> "$LOOKUP_CREDS"
                    printf '%s' "$OUTPUTS"
                fi
            }
            npx() {
                printf '%s\\n' "$AWS_ACCESS_KEY_ID" "$AWS_SECRET_ACCESS_KEY" "$AWS_SESSION_TOKEN" >> "$DEPLOY_CREDS"
                printf '%s\\n' "$@" >> "$ARGS"
            }
            ${script}
        `], {
            cwd: directory,
            encoding: 'utf8',
            env: {
                ...process.env,
                DEPLOY_ENVIRONMENT: environment,
                OUTPUTS: JSON.stringify(outputs),
                CALLS: join(directory, 'calls'),
                ARGS: join(directory, 'args'),
                LOOKUP_CREDS: join(directory, 'lookup-creds'),
                DEPLOY_CREDS: join(directory, 'deploy-creds'),
                CDK_DEFAULT_ACCOUNT: '334624057595',
                CDK_DEFAULT_REGION: 'eu-west-2',
                TMDB_API_KEY: tmdbApiKey,
                PROD_POSTMAN_CLIENT_ID: postmanClientId,
                AWS_ACCESS_KEY_ID: 'original-key',
                AWS_SECRET_ACCESS_KEY: 'original-secret',
                AWS_SESSION_TOKEN: 'original-token',
                FAIL_ASSUME_ROLE: String(failAssumeRole),
            },
        });
    }

    it('passes production stack outputs to the dev template', () => {
        const result = runStep({ ProdUserPoolId: {}, ProdUserPoolClientId: {} }, {
            Stacks: [{ Outputs: [
                { OutputKey: 'UserPoolId', OutputValue: 'eu-west-2_pool' },
                { OutputKey: 'UserPoolClientId', OutputValue: 'clientid' },
            ] }],
        });
        expect(result.status).toBe(0);
        expect(readFileSync(join(directory, 'calls'), 'utf8'))
            .toContain('describe-stacks --stack-name BlockbusterTheatreBackendStack');
        expect(readFileSync(join(directory, 'calls'), 'utf8')).toContain(
            'sts assume-role --role-arn arn:aws:iam::334624057595:role/cdk-hnb659fds-deploy-role-334624057595-eu-west-2'
        );
        expect(readFileSync(join(directory, 'lookup-creds'), 'utf8'))
            .toBe('lookup-key\nlookup-secret\nlookup-token\n');
        expect(readFileSync(join(directory, 'deploy-creds'), 'utf8'))
            .toBe('original-key\noriginal-secret\noriginal-token\n');
        expect(readFileSync(join(directory, 'args'), 'utf8'))
            .toContain('--parameters\nProdUserPoolId=eu-west-2_pool\n--parameters\nProdUserPoolClientId=clientid\n');
    });

    it('fails before deployment when a required output is missing', () => {
        const result = runStep({ ProdUserPoolClientId: {} }, { Stacks: [{ Outputs: [] }] });
        expect(result.status).not.toBe(0);
        expect(result.stdout).toContain('Production stack output UserPoolClientId is missing');
        expect(() => readFileSync(join(directory, 'args'))).toThrow();
    });

    it('fails before reading outputs or deploying if the bootstrap role cannot be assumed', () => {
        const result = runStep({ ProdUserPoolId: {} }, {}, 'dev', true);
        expect(result.status).not.toBe(0);
        expect(readFileSync(join(directory, 'calls'), 'utf8')).not.toContain('describe-stacks');
        expect(() => readFileSync(join(directory, 'args'))).toThrow();
    });

    it('only supplies the output for an unconfigured pool value', () => {
        const result = runStep({ ProdUserPoolClientId: {} }, {
            Stacks: [{ Outputs: [{ OutputKey: 'UserPoolClientId', OutputValue: 'clientid' }] }],
        });
        expect(result.status).toBe(0);
        const args = readFileSync(join(directory, 'args'), 'utf8');
        expect(args).toContain('--parameters\nProdUserPoolClientId=clientid\n');
        expect(args).not.toContain('ProdUserPoolId=');
    });

    it('passes the configured Postman client ID only when required by dev', () => {
        const result = runStep({ ProdPostmanClientId: {} }, {});
        expect(result.status).toBe(0);
        expect(readFileSync(join(directory, 'args'), 'utf8'))
            .toContain('--parameters\nProdPostmanClientId=postmanclientid\n');
        expect(() => readFileSync(join(directory, 'calls'))).toThrow();
    });

    it('refuses to deploy dev if its required Postman client ID is missing', () => {
        const result = runStep({ ProdPostmanClientId: {} }, {}, 'dev', false, 'key', '   ');
        expect(result.status).not.toBe(0);
        expect(result.stdout).toContain('PROD_POSTMAN_CLIENT_ID must be configured');
        expect(() => readFileSync(join(directory, 'args'))).toThrow();
    });

    it('does not fetch or pass outputs for prod or an explicitly configured dev template', () => {
        for (const environment of ['dev', 'prod']) {
            const result = runStep({}, {}, environment);
            expect(result.status).toBe(0);
            expect(() => readFileSync(join(directory, 'calls'))).toThrow();
            expect(readFileSync(join(directory, 'args'), 'utf8'))
                .toContain('--parameters\nTmdbApiKey=test-deploy-key\n');
        }
    });

    it('refuses to deploy without an environment-scoped TMDB key', () => {
        const result = runStep({}, {}, 'prod', false, '   ');
        expect(result.status).not.toBe(0);
        expect(result.stdout).toContain('TMDB_API_KEY must be configured');
        expect(() => readFileSync(join(directory, 'args'))).toThrow();
    });
});

describe('deploy build selection', () => {
    let directory: string;
    let workflow: string;
    let script: string;
    const sha = 'a'.repeat(40);

    beforeEach(() => {
        directory = mkdtempSync(join(tmpdir(), 'deploy-test-'));
        workflow = readFileSync(join(process.cwd(), '.github/workflows/deploy.yml'), 'utf8')
            .replace(/\r\n/g, '\n');
        const step = workflow.split('      - name: Select Build\n')[1]
            .split('      - name: Checkout Build Source\n')[0];
        script = step.split('        run: |\n')[1].replace(/^          /gm, '');
    });

    afterEach(() => {
        rmSync(directory, { recursive: true, force: true });
    });

    function runStep(buildInfo: string, env: Record<string, string> = {}) {
        return spawnSync('bash', ['-e', '-c', `
            gh() {
                echo "$*" >> "$CALLS"
                printf '%s' "$BUILD_INFO"
            }
            ${script}
        `], {
            encoding: 'utf8',
            env: {
                ...process.env,
                GITHUB_EVENT_NAME: 'workflow_dispatch',
                GITHUB_REPOSITORY: 'owner/repo',
                GITHUB_REF: 'refs/heads/main',
                INPUT_ENVIRONMENT: 'dev',
                GITHUB_OUTPUT: join(directory, 'output'),
                GITHUB_STEP_SUMMARY: join(directory, 'summary'),
                CALLS: join(directory, 'calls'),
                BUILD_INFO: buildInfo,
                ...env,
            },
        });
    }

    it('selects the latest build across branches for dev', () => {
        const result = runStep(`12345\t42\t${sha}\tenvironment-control`);
        expect(result.status).toBe(0);
        const calls = readFileSync(join(directory, 'calls'), 'utf8');
        expect(calls).toContain('actions/workflows/build.yml/runs?per_page=100');
        expect(calls).toContain('.workflow_runs[0]');
        expect(calls).not.toContain('branch=');
        expect(calls).not.toContain('status=');
        expect(readFileSync(join(directory, 'output'), 'utf8')).toContain(
            `build_number=42\nbuild_run_id=12345\ndeploy_environment=dev\ndeploy_branch=environment-control\nbuild_sha=${sha}`
        );
    });

    it.each([
        ['dev', 'refs/heads/main', 'dev'],
        ['prod', 'refs/heads/main', 'prod'],
        ['auto', 'refs/heads/main', 'prod'],
        ['auto', 'refs/heads/feature', 'dev'],
    ])('resolves target_env %s on %s to %s', (input, ref, expected) => {
        const info = expected === 'prod'
            ? `12345\t42\t${sha}\tmain\tpush\tsuccess\towner/repo`
            : `12345\t42\t${sha}\tfeature`;
        const result = runStep(info, {
            INPUT_ENVIRONMENT: '', INPUT_TARGET_ENV: input, GITHUB_REF: ref,
        });
        expect(result.status).toBe(0);
        expect(readFileSync(join(directory, 'output'), 'utf8'))
            .toContain(`deploy_environment=${expected}`);
    });

    it('rejects conflicting target and legacy environment inputs', () => {
        const result = runStep('', { INPUT_TARGET_ENV: 'prod', INPUT_ENVIRONMENT: 'dev' });
        expect(result.status).toBe(1);
        expect(result.stdout).toContain('environment input disagree');
    });

    it('finds a successful main push build for prod', () => {
        const result = runStep(`23456\t17\t${sha}\tmain\tpush\tsuccess\towner/repo`, {
            INPUT_ENVIRONMENT: 'prod', INPUT_BUILD_NUMBER: '17',
        });
        expect(result.status).toBe(0);
        const calls = readFileSync(join(directory, 'calls'), 'utf8');
        expect(calls).toContain('--paginate');
        expect(calls).toContain('event=push&status=success');
        expect(calls).toContain('-f branch=main');
        expect(calls).toContain('select(.run_number == 17)');
        expect(readFileSync(join(directory, 'output'), 'utf8'))
            .toContain(`deploy_environment=prod\ndeploy_branch=main\nbuild_sha=${sha}`);
    });

    it('selects the latest successful main push for prod', () => {
        const result = runStep(`23456\t17\t${sha}\tmain\tpush\tsuccess\towner/repo`, {
            INPUT_ENVIRONMENT: 'prod',
        });
        expect(result.status).toBe(0);
        const calls = readFileSync(join(directory, 'calls'), 'utf8');
        expect(calls).toContain('event=push&status=success');
        expect(calls).toContain('-f branch=main');
        expect(calls).toContain('.workflow_runs[0]');
    });

    it('rejects prod dispatch from outside main before querying builds', () => {
        const result = runStep('', { INPUT_ENVIRONMENT: 'prod', GITHUB_REF: 'refs/heads/dev' });
        expect(result.status).toBe(1);
        expect(result.stdout).toContain('must be triggered from main');
    });

    it.each([
        ['feature', 'push', 'success', 'owner/repo'],
        ['main', 'pull_request', 'success', 'owner/repo'],
        ['main', 'push', 'failure', 'owner/repo'],
        ['main', 'push', 'success', 'other/repo'],
    ])('rejects untrusted prod build metadata: %s %s %s %s', (branch, event, conclusion, repository) => {
        const result = runStep(`23456\t17\t${sha}\t${branch}\t${event}\t${conclusion}\t${repository}`, {
            INPUT_ENVIRONMENT: 'prod',
        });
        expect(result.status).toBe(1);
        expect(result.stdout).toContain(branch === 'feature'
            ? 'Production requires a main push build'
            : 'Production requires a successful push build');
    });

    it('allows the latest successful push from the selected branch with the prod override', () => {
        const result = runStep(`23456\t17\t${sha}\tfeature/example\tpush\tsuccess\towner/repo`, {
            INPUT_ENVIRONMENT: 'prod',
            INPUT_ALLOW_NON_MAIN_PROD: 'true',
            GITHUB_REF: 'refs/heads/feature/example',
        });
        expect(result.status).toBe(0);
        expect(readFileSync(join(directory, 'calls'), 'utf8')).toContain('-f branch=feature/example');
        expect(readFileSync(join(directory, 'output'), 'utf8')).toContain('deploy_branch=feature/example');
        expect(result.stdout).toContain('Production branch override enabled');
    });

    it('allows a numbered successful push from another branch with the prod override', () => {
        const result = runStep(`23456\t17\t${sha}\tfeature\tpush\tsuccess\towner/repo`, {
            INPUT_ENVIRONMENT: 'prod', INPUT_BUILD_NUMBER: '17', INPUT_ALLOW_NON_MAIN_PROD: 'true',
        });
        expect(result.status).toBe(0);
        expect(readFileSync(join(directory, 'calls'), 'utf8')).not.toContain('-f branch=');
    });

    it.each([
        ['feature', 'pull_request', 'success', 'owner/repo'],
        ['feature', 'push', 'failure', 'owner/repo'],
        ['feature', 'push', 'success', 'other/repo'],
    ])('rejects unsafe prod override builds: %s %s %s %s', (branch, event, conclusion, repository) => {
        const result = runStep(`23456\t17\t${sha}\t${branch}\t${event}\t${conclusion}\t${repository}`, {
            INPUT_ENVIRONMENT: 'prod', INPUT_ALLOW_NON_MAIN_PROD: 'true', INPUT_BUILD_NUMBER: '17',
        });
        expect(result.status).toBe(1);
    });

    it('rejects a latest override build from a different branch and rejects tag dispatches', () => {
        expect(runStep(`23456\t17\t${sha}\tother\tpush\tsuccess\towner/repo`, {
            INPUT_ENVIRONMENT: 'prod', INPUT_ALLOW_NON_MAIN_PROD: 'true', GITHUB_REF: 'refs/heads/feature',
        }).status).toBe(1);
        expect(runStep('', {
            INPUT_ENVIRONMENT: 'prod', INPUT_ALLOW_NON_MAIN_PROD: 'true', GITHUB_REF: 'refs/tags/v1',
        }).status).toBe(1);
    });

    it.each(['', '\t', '12345\t42\tinvalid\tmain'])('rejects invalid build lookup %p', info => {
        const result = runStep(info);
        expect(result.status).toBe(1);
        expect(result.stdout).toContain('No build found');
    });

    it('rejects invalid build numbers and environments', () => {
        expect(runStep('', { INPUT_BUILD_NUMBER: '1; echo bad' }).status).toBe(1);
        expect(runStep('', { INPUT_ENVIRONMENT: 'prod', INPUT_BUILD_NUMBER: '1; echo bad' }).status).toBe(1);
        expect(runStep('', { INPUT_ENVIRONMENT: 'prod' }).status).toBe(1);
        expect(runStep('', { INPUT_ENVIRONMENT: 'prod', INPUT_ALLOW_NON_MAIN_PROD: 'yes' }).status).toBe(1);
        expect(runStep('', { INPUT_ENVIRONMENT: 'staging' }).status).toBe(1);
    });

    it.each([['dev', 'dev'], ['main', 'prod']])('uses the triggering %s build', (branch, environment) => {
        const result = runStep('', {
            GITHUB_EVENT_NAME: 'workflow_run',
            TRIGGER_RUN_ID: '67890',
            TRIGGER_RUN_NUMBER: '43',
            TRIGGER_HEAD_BRANCH: branch,
            TRIGGER_HEAD_SHA: sha,
        });
        expect(result.status).toBe(0);
        expect(readFileSync(join(directory, 'output'), 'utf8'))
            .toContain(`deploy_environment=${environment}\ndeploy_branch=${branch}\nbuild_sha=${sha}`);
    });

    it('synthesizes the selected source and refuses an assembly for the wrong environment', () => {
        expect(workflow).toContain('ref: ${{ steps.select_build.outputs.build_sha }}');
        expect(workflow).toContain('name: ${{ needs.prepare.outputs.deploy_environment }}');
        expect(workflow).toContain('TMDB_API_KEY: ${{ secrets.TMDB_API_KEY }}');
        const synth = workflow.split('      - name: Synthesize CDK App\n')[1]
            .split('      - name: Upload Deployment Assembly\n')[0]
            .split('        run: |\n')[1].replace(/^          /gm, '');
        const runSynth = (environment: string, stack: string) => {
            writeFileSync(join(directory, 'manifest.json'), JSON.stringify({
                artifacts: { [stack]: { type: 'aws:cloudformation:stack' } },
            }));
            return spawnSync('bash', ['-e', '-c', `
                npx() { mkdir -p cdk-out; cp manifest.json cdk-out/manifest.json; }
                ${synth}
            `], { cwd: directory, encoding: 'utf8', env: { ...process.env, DEPLOY_ENVIRONMENT: environment } });
        };
        expect(runSynth('dev', 'BlockbusterTheatreBackendStack-dev').status).toBe(0);
        expect(runSynth('prod', 'BlockbusterTheatreBackendStack').status).toBe(0);
        expect(runSynth('dev', 'BlockbusterTheatreBackendStack').status).toBe(1);
    });

    it('validates deployment assets before assuming AWS credentials', () => {
        const validate = workflow.split('      - name: Validate Deployment Assembly\n')[1]
            .split('      - name: Configure AWS Credentials\n')[0]
            .split('        run: |\n')[1].replace(/^          /gm, '');
        const root = join(directory, 'cdk-out');
        mkdirSync(root);
        const stack = 'BlockbusterTheatreBackendStack-dev';
        const assetName = `asset.${'b'.repeat(64)}`;
        mkdirSync(join(root, assetName));
        writeFileSync(join(root, `${stack}.template.json`), JSON.stringify({
            Parameters: { TmdbApiKey: { Type: 'String', NoEcho: true } },
            Resources: Object.fromEntries([
                'blockbuster-theatre-add-movies-handler',
                'blockbuster-theatre-refresh-movie-collection-handler',
            ].map((name, index) => [`Function${index}`, {
                Type: 'AWS::Lambda::Function',
                Properties: {
                    FunctionName: `${name}-DEV`,
                    Environment: { Variables: { TMDB_API_KEY: { Ref: 'TmdbApiKey' } } },
                },
            }])),
        }));
        writeFileSync(join(root, 'manifest.json'), JSON.stringify({ artifacts: {
            [stack]: { type: 'aws:cloudformation:stack', properties: { templateFile: `${stack}.template.json` } },
            assets: { type: 'cdk:asset-manifest', properties: { file: `${stack}.assets.json` } },
        } }));
        const runValidation = (source: object, dockerImages = {}) => {
            writeFileSync(join(root, `${stack}.assets.json`), JSON.stringify({
                files: { asset: { source } }, dockerImages,
            }));
            return spawnSync('bash', ['-e', '-c', validate], {
                cwd: directory, encoding: 'utf8', env: { ...process.env, DEPLOY_ENVIRONMENT: 'dev' },
            });
        };
        expect(runValidation({ path: assetName, packaging: 'zip' }).status).toBe(0);
        expect(runValidation({ path: `${stack}.template.json`, packaging: 'file' }).status).toBe(0);
        expect(runValidation({ executable: ['sh', '-c', 'echo bad'] }).status).toBe(1);
        expect(runValidation({ path: '../secret', packaging: 'file' }).status).toBe(1);
        expect(runValidation({ path: assetName, packaging: 'zip' }, { image: {} }).status).toBe(1);
        writeFileSync(join(root, `${stack}.template.json`), '{}');
        expect(runValidation({ path: assetName, packaging: 'zip' }).status).toBe(1);
    });
});
