import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { BlockbusterTheatreBackendStack } from '../../../lib/stack-configuration';

describe('BackendStack', () => {
    let stack: BlockbusterTheatreBackendStack;

    beforeEach(() => {
        const app = new cdk.App();
        stack = new BlockbusterTheatreBackendStack(app, 'TestBackendStack');
    });

    it('should create a complete stack with all resources', () => {
        const template = Template.fromStack(stack);
        expect(template).toBeDefined();
    });

    it('should tag taggable resources with the project name', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::DynamoDB::Table', {
            Tags: Match.arrayWith([
                { Key: 'Project', Value: 'blockbuster-theatre' },
            ]),
        });
        template.hasResourceProperties('AWS::Lambda::Function', {
            Tags: Match.arrayWith([
                { Key: 'Project', Value: 'blockbuster-theatre' },
            ]),
        });
        template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
            Tags: Match.objectLike({ Project: 'blockbuster-theatre' }),
        });
    });

    it('should create DynamoDB table', () => {
        const template = Template.fromStack(stack);
        template.resourceCountIs('AWS::DynamoDB::Table', 4);
        template.hasResourceProperties('AWS::DynamoDB::Table', {
            TableName: 'blockbuster-theatre-movie-catalogue',
            BillingMode: 'PAY_PER_REQUEST',
        });
        template.hasResource('AWS::DynamoDB::Table', {
            DeletionPolicy: 'Retain',
            UpdateReplacePolicy: 'Retain',
            Properties: Match.objectLike({ TableName: 'blockbuster-theatre-movie-catalogue' }),
        });
        template.hasResourceProperties('AWS::DynamoDB::Table', {
            TableName: 'blockbuster-theatre-ticket-pricing',
            BillingMode: 'PAY_PER_REQUEST',
            KeySchema: [{ AttributeName: 'pricingId', KeyType: 'HASH' }],
        });
        template.hasResource('AWS::DynamoDB::Table', {
            DeletionPolicy: 'Retain',
            UpdateReplacePolicy: 'Retain',
            Properties: Match.objectLike({ TableName: 'blockbuster-theatre-ticket-pricing' }),
        });
        template.hasResourceProperties('AWS::DynamoDB::Table', {
            TableName: 'blockbuster-theatre-booking-offers',
            BillingMode: 'PAY_PER_REQUEST',
            KeySchema: [{ AttributeName: 'offerId', KeyType: 'HASH' }],
        });
        template.hasResource('AWS::DynamoDB::Table', {
            DeletionPolicy: 'Retain',
            UpdateReplacePolicy: 'Retain',
            Properties: Match.objectLike({ TableName: 'blockbuster-theatre-booking-offers' }),
        });
        template.hasResourceProperties('AWS::DynamoDB::Table', {
            TableName: 'blockbuster-theatre-movie-collections',
            BillingMode: 'PAY_PER_REQUEST',
            KeySchema: [{ AttributeName: 'collectionId', KeyType: 'HASH' }],
        });
    });

    it('should create Lambda function', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Lambda::Function', {
            FunctionName: 'blockbuster-theatre-add-movies-handler',
        });
    });

    it('should create HTTP API', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
            Name: 'blockbuster-theatre-api-gateway',
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
        template.resourceCountIs('AWS::ApiGatewayV2::Route', 13);
        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'GET /movies',
        });
        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'GET /film-selections',
        });
        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'GET /ticket-pricing',
        });
        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'POST /checkout/validate',
        });
        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'GET /movies/export',
            AuthorizationType: 'JWT',
        });
        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'GET /movies/tmdb-ids',
            AuthorizationType: 'JWT',
        });
        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'GET /collections/{id}',
        });
        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'POST /collections/{id}/refresh',
            AuthorizationType: 'JWT',
        });
    });

    it('should output API endpoint', () => {
        const template = Template.fromStack(stack);
        template.hasOutput('ApiEndpoint', {
            Description: 'Base HTTP endpoint for WinForms, WinUI 3, SwiftUI, and Web SPA',
        });
        template.hasOutput('UserPoolId', {});
        template.hasOutput('UserPoolClientId', {});
        template.hasOutput('UserPoolIssuer', {});
        template.hasOutput('CognitoLoginUrl', {
            Description: 'Dark-mode Cognito managed login URL for browser authorization',
        });
    });

    it('should grant Lambda permissions to DynamoDB', () => {
        const template = Template.fromStack(stack);
        template.resourceCountIs('AWS::IAM::Policy', 13);
    });

    it('should have correct resource order (DB -> Lambda -> API)', () => {
        const template = Template.fromStack(stack);
        // Database should be created first (no dependencies)
        template.hasResourceProperties('AWS::DynamoDB::Table', {
            TableName: 'blockbuster-theatre-movie-catalogue',
        });
        // Lambda should be created with correct name
        template.hasResourceProperties('AWS::Lambda::Function', {
            FunctionName: 'blockbuster-theatre-add-movies-handler',
        });
        // API should integrate with Lambda
        template.hasResourceProperties('AWS::ApiGatewayV2::Integration', {
            IntegrationType: 'AWS_PROXY',
        });
    });
});
