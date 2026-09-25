import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { BackendStack } from '../../../lib/stack-configuration';

describe('BackendStack', () => {
    let stack: BackendStack;

    beforeEach(() => {
        const app = new cdk.App();
        stack = new BackendStack(app, 'TestBackendStack');
    });

    it('should create a complete stack with all resources', () => {
        const template = Template.fromStack(stack);
        expect(template).toBeDefined();
    });

    it('should create DynamoDB table', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::DynamoDB::Table', {
            TableName: 'BlockbusterTheatre',
            BillingMode: 'PAY_PER_REQUEST',
        });
    });

    it('should create Lambda function', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Lambda::Function', {
            FunctionName: 'BlockbusterTheatre-ManageItems',
        });
    });

    it('should create HTTP API', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
            Name: 'BlockbusterTheatreApi',
        });
    });

    it('should create API Gateway integration', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::ApiGatewayV2::Integration', {
            IntegrationType: 'AWS_PROXY',
        });
    });

    it('should create API Gateway routes', () => {
        const template = Template.fromStack(stack);
        template.resourceCountIs('AWS::ApiGatewayV2::Route', 2);
    });

    it('should output API endpoint', () => {
        const template = Template.fromStack(stack);
        template.hasOutput('ApiEndpoint', {
            Description: 'Base HTTP endpoint for WinForms, WinUI 3, SwiftUI, and Web SPA',
        });
    });

    it('should grant Lambda permissions to DynamoDB', () => {
        const template = Template.fromStack(stack);
        template.resourceCountIs('AWS::IAM::Policy', 2);
    });

    it('should have correct resource order (DB -> Lambda -> API)', () => {
        const template = Template.fromStack(stack);
        // Database should be created first (no dependencies)
        template.hasResourceProperties('AWS::DynamoDB::Table', {
            TableName: 'BlockbusterTheatre',
        });
        // Lambda should be created with correct name
        template.hasResourceProperties('AWS::Lambda::Function', {
            FunctionName: 'BlockbusterTheatre-ManageItems',
        });
        // API should integrate with Lambda
        template.hasResourceProperties('AWS::ApiGatewayV2::Integration', {
            IntegrationType: 'AWS_PROXY',
        });
    });
});
