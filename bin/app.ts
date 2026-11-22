import 'dotenv/config';
import * as cdk from 'aws-cdk-lib';
import { AuthStack } from '../lib/auth';
import { BackendStack } from '../lib/backend';

const app = new cdk.App();

const awsEnv: cdk.Environment = {
    account: process.env.CDK_DEFAULT_ACCOUNT || '334624057595',
    region: 'eu-west-2',
};

// Filter stacks when specified via context (e.g. -c stack=auth, -c stack=backend, -c env=prod, -c env=dev)
const stackContext = app.node.tryGetContext('stack') as string | undefined;
const envContext = app.node.tryGetContext('env') as string | undefined;

const shouldInstantiateAuth = !stackContext || stackContext === 'auth' || stackContext === 'all';
const shouldInstantiateBackend = !stackContext || stackContext === 'backend' || stackContext === 'all';

// 1. Dedicated AuthStack owning Cognito User Pool, Clients, Domain, and Resource Servers
if (shouldInstantiateAuth && (!envContext || envContext === 'prod' || stackContext === 'auth')) {
    new AuthStack(app, 'BlockbusterTheatreAuthStack', {
        env: awsEnv
    });
}

// 2. Environment-specific BackendStack instances (prod and dev) consuming SSM parameters
if (shouldInstantiateBackend) {
    if (!envContext || envContext === 'prod') {
        new BackendStack(app, 'BlockbusterTheatreBackendStack', {
            description: 'BlockbusterTheatre Backend Infrastructure (Prod)',
            envName: 'prod',
            env: awsEnv
        });
    }

    if (!envContext || envContext === 'dev') {
        new BackendStack(app, 'BlockbusterTheatreBackendStack-dev', {
            description: 'BlockbusterTheatre Backend Infrastructure (Dev)',
            envName: 'dev',
            env: awsEnv,
        });
    }
}

app.synth();
