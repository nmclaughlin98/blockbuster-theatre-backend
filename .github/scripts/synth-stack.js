const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

const deployStack = process.env.DEPLOY_STACK;
const deployEnv = process.env.DEPLOY_ENVIRONMENT;

const expectedStack =
    deployStack === 'auth'
        ? 'BlockbusterTheatreAuthStack'
        : deployEnv === 'dev'
            ? 'BlockbusterTheatreBackendStack-dev'
            : 'BlockbusterTheatreBackendStack';

const cdkArgs =
    deployStack === 'auth'
        ? ['cdk', 'synth', expectedStack, '-c', 'stack=auth', '--output', 'cdk-out']
        : ['cdk', 'synth', expectedStack, '-c', `env=${deployEnv}`, '-c', 'stack=backend', '--output', 'cdk-out'];

execFileSync('npx', cdkArgs, { stdio: 'inherit' });

const manifest = JSON.parse(fs.readFileSync('./cdk-out/manifest.json', 'utf8'));
const stacks = Object.entries(manifest.artifacts)
    .filter(([, artifact]) => artifact.type === 'aws:cloudformation:stack')
    .map(([name]) => name);

if (stacks.length !== 1 || stacks[0] !== expectedStack) {
    console.error(`Expected only ${expectedStack}; synthesized: ${stacks.join(', ') || 'no stacks'}`);
    process.exit(1);
}