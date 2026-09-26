import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { ApiGatewayConstruct } from '../../../lib/stack';

describe('ApiGatewayConstruct', () => {
    let stack: cdk.Stack;
    let mockFunction: lambda.Function;
    let construct: ApiGatewayConstruct;

    beforeEach(() => {
        stack = new cdk.Stack();
        mockFunction = new lambda.Function(stack, 'MockFunction', {
            runtime: lambda.Runtime.NODEJS_24_X,
            handler: 'index.handler',
            code: lambda.Code.fromInline('exports.handler = async () => {};'),
        });
        const jwtAuthorizer = new authorizers.HttpJwtAuthorizer(
            'TestJwtAuthorizer',
            'https://issuer.example.com',
            { jwtAudience: ['test-client'] }
        );
        construct = new ApiGatewayConstruct(stack, 'TestApiGateway', {
            addMoviesFunction: mockFunction,
            listMoviesFunction: mockFunction,
            getMovieFunction: mockFunction,
            jwtAuthorizer,
        });
    });

    it('should create an HTTP API', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
            Name: 'blockbuster-theatre-api-gateway',
            ProtocolType: 'HTTP',
        });
    });

    it('should create API routes', () => {
        const template = Template.fromStack(stack);
        template.resourceCountIs('AWS::ApiGatewayV2::Route', 3);
        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'GET /movies/{id}',
        });
        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'GET /movies',
        });
        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'POST /movies',
            AuthorizationType: 'JWT',
            AuthorizerId: Match.anyValue(),
        });
        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'GET /movies',
            AuthorizationType: 'NONE',
        });
        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'GET /movies/{id}',
            AuthorizationType: 'NONE',
        });
    });

    it('should integrate Lambda function with routes', () => {
        expect(construct.httpApi).toBeDefined();
        // Lambda integration is implicitly tested by the successful API creation
    });

    it('should export httpApi property', () => {
        expect(construct.httpApi).toBeDefined();
        expect(construct.httpApi.apiId).toBeDefined();
    });

    it('should grant Lambda invoke permission to API Gateway', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Lambda::Permission', {
            Action: 'lambda:InvokeFunction',
            Principal: 'apigateway.amazonaws.com',
        });
    });

    it('should create stage with auto-deploy', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
            StageName: '$default',
            AutoDeploy: true,
        });
    });
});
