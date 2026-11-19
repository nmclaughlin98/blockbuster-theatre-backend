import * as cdk from 'aws-cdk-lib';
import { BlockbusterTheatreBackendStack } from '../stack-configuration';
import { parseEnvironmentName, resourceName } from './environment';

const app = new cdk.App();
const envName = parseEnvironmentName(app.node.tryGetContext('env'));

function optionalConfigValue(contextKey: string, environmentKey: string): string | undefined {
    const contextValue: unknown = app.node.tryGetContext(contextKey);
    if (contextValue !== undefined) {
        if (typeof contextValue !== 'string' || !contextValue.trim()) {
            throw new Error(`${contextKey} must be a non-empty string.`);
        }
        return contextValue.trim();
    }
    const environmentValue = process.env[environmentKey]?.trim();
    return environmentValue || undefined;
}

new BlockbusterTheatreBackendStack(app, resourceName('BlockbusterTheatreBackendStack', envName), {
    description: 'BlockbusterTheatre Backend Infrastructure',
    envName,
    prodUserPoolId: optionalConfigValue('prodUserPoolId', 'PROD_USER_POOL_ID'),
    prodUserPoolClientId: optionalConfigValue(
        'prodUserPoolClientId',
        'PROD_USER_POOL_CLIENT_ID'
    ),
    env: {
        account: '334624057595',
        region: 'eu-west-2',
    },
});

app.synth();
