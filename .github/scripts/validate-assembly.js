const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve('cdk-out');
const isAuth = process.env.DEPLOY_STACK === 'auth';
const deployEnv = process.env.DEPLOY_ENVIRONMENT;

const expected = isAuth
    ? 'BlockbusterTheatreAuthStack'
    : deployEnv === 'dev'
        ? 'BlockbusterTheatreBackendStack-dev'
        : 'BlockbusterTheatreBackendStack';

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const artifacts = manifest.artifacts;
const allowed = new Set([
    'aws:cloudformation:stack',
    'cdk:asset-manifest',
    'cdk:tree',
    'cdk:feature-flag-report',
]);

const stacks = Object.entries(artifacts).filter(([, a]) => a.type === 'aws:cloudformation:stack');
if (
    stacks.length !== 1 ||
    stacks[0][0] !== expected ||
    stacks[0][1].properties.templateFile !== `${expected}.template.json` ||
    Object.values(artifacts).some((a) => !allowed.has(a.type))
) {
    throw new Error('Unexpected assembly artifacts');
}

const template = JSON.parse(fs.readFileSync(path.join(root, `${expected}.template.json`), 'utf8'));

if (!isAuth) {
    if (template.Parameters?.TmdbApiKey?.NoEcho !== true) {
        throw new Error('Missing masked TMDB key parameter');
    }

    const prefix = `blockbuster-theatre-${deployEnv}-`;
    const tmdbLambdas = [
        'blockbuster-theatre-add-movies-handler',
        'blockbuster-theatre-refresh-movie-collection-handler',
    ];

    for (const name of tmdbLambdas) {
        const matches = Object.values(template.Resources || {}).filter(
            (r) => r.Type === 'AWS::Lambda::Function'
                && r.Properties?.FunctionName === name.replace('blockbuster-theatre-', prefix)
        );

        if (
            matches.length !== 1 ||
            matches[0].Properties.Environment?.Variables?.TMDB_API_KEY?.Ref !== 'TmdbApiKey'
        ) {
            throw new Error(`Unexpected TMDB key configuration for ${name.replace('blockbuster-theatre-', prefix)}`);
        }
    }
} else {
    const pools = Object.values(template.Resources || {}).filter(
        (r) => r.Type === 'AWS::Cognito::UserPool'
    );

    if (pools.length !== 1 || pools[0].Properties?.UserPoolName !== `blockbuster-theatre-users`) {
        throw new Error('Missing or invalid Cognito UserPool in BlockbusterTheatreAuthStack');
    }
}

for (const artifact of Object.values(artifacts).filter((a) => a.type === 'cdk:asset-manifest')) {
    const file = artifact.properties.file;
    if (file !== `${expected}.assets.json`) {
        throw new Error('Unexpected asset manifest');
    }

    const assets = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
    if (Object.keys(assets.dockerImages || {}).length) {
        throw new Error('Docker assets are not supported');
    }

    for (const asset of Object.values(assets.files || {})) {
        const source = asset.source;
        const hasOnlyExpectedKeys =
            source && Object.keys(source).every((k) => k === 'path' || k === 'packaging');
        const hasValidPath =
            source &&
            (/^asset\.[0-9a-f]{64}$/.test(source.path) ||
                (source.path === `${expected}.template.json` && source.packaging === 'file'));
        const hasValidPackaging = source && ['zip', 'file'].includes(source.packaging);

        if (
            !hasOnlyExpectedKeys ||
            !hasValidPath ||
            !hasValidPackaging ||
            fs.lstatSync(path.join(root, source.path)).isSymbolicLink()
        ) {
            throw new Error('Unexpected asset source');
        }
    }
}