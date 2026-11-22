const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

const deployStack = process.env.DEPLOY_STACK;
const deployEnv = process.env.DEPLOY_ENVIRONMENT;

const backendStack =
    deployEnv === 'dev' ? 'BlockbusterTheatreBackendStack-dev' : 'BlockbusterTheatreBackendStack';

let expectedStacks;
let cdkArgs;

if (deployStack === 'auth') {
    expectedStacks = ['BlockbusterTheatreAuthStack'];
    cdkArgs = ['cdk', 'synth', ...expectedStacks, '-c', 'stack=auth', '--output', 'cdk-out'];
} else if (deployStack === 'both') {
    expectedStacks = ['BlockbusterTheatreAuthStack', backendStack];
    cdkArgs = ['cdk', 'synth', ...expectedStacks, '-c', `env=${deployEnv}`, '-c', 'stack=all', '--output', 'cdk-out'];
} else {
    expectedStacks = [backendStack];
    cdkArgs = ['cdk', 'synth', ...expectedStacks, '-c', `env=${deployEnv}`, '-c', 'stack=backend', '--output', 'cdk-out'];
}

execFileSync('npx', cdkArgs, { stdio: 'inherit' });

const manifest = JSON.parse(fs.readFileSync('./cdk-out/manifest.json', 'utf8'));
const stacks = Object.entries(manifest.artifacts)
    .filter(([, artifact]) => artifact.type === 'aws:cloudformation:stack')
    .map(([name]) => name);

const missingStacks = expectedStacks.filter((name) => !stacks.includes(name));
const unexpectedStacks = stacks.filter((name) => !expectedStacks.includes(name));

if (missingStacks.length > 0 || unexpectedStacks.length > 0) {
    console.error(
        `Expected stacks [${expectedStacks.join(', ')}]; synthesized: [${stacks.join(', ') || 'no stacks'}]`
    );
    process.exit(1);
}