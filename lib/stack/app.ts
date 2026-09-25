import * as cdk from 'aws-cdk-lib';
import { BlockbusterTheatreBackendStack } from '../stack-configuration';

const app = new cdk.App();

new BlockbusterTheatreBackendStack(app, 'BlockbusterTheatreStack', {
    description: 'BlockbusterTheatre Backend Infrastructure',
    env: {
        account: '334624057595',
        region: 'eu-west-2',
    },
});

app.synth();
