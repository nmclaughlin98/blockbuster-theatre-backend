const { execFileSync } = require('node:child_process');

const deployStack = process.env.DEPLOY_STACK;
const deployEnv = process.env.DEPLOY_ENVIRONMENT;
const tmdbApiKey = process.env.TMDB_API_KEY || '';

function deployAuth() {
    console.log('Deploying Auth Stack: BlockbusterTheatreAuthStack');
    execFileSync(
        'npx',
        ['cdk', 'deploy', 'BlockbusterTheatreAuthStack', '--app', 'cdk-out', '--require-approval', 'never'],
        { stdio: 'inherit' },
    );
}

function deployBackend() {
    if (!/\S/.test(tmdbApiKey)) {
        console.error('Error: TMDB_API_KEY must be configured as a non-empty GitHub Environment secret.');
        process.exit(1);
    }

    const targetStack =
        deployEnv === 'dev' ? 'BlockbusterTheatreBackendStack-dev' : 'BlockbusterTheatreBackendStack';
    console.log(`Deploying Backend Stack: ${targetStack}`);

    execFileSync(
        'npx',
        [
            'cdk',
            'deploy',
            targetStack,
            '--app',
            'cdk-out',
            '--require-approval',
            'never',
            '--parameters',
            `TmdbApiKey=${tmdbApiKey}`,
        ],
        { stdio: 'inherit' },
    );
}

if (deployStack === 'auth') {
    deployAuth();
} else if (deployStack === 'both') {
    deployAuth();
    deployBackend();
} else {
    deployBackend();
}
