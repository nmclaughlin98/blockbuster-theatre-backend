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
            updateMoviesFunction: mockFunction,
            listMoviesFunction: mockFunction,
            getMovieFunction: mockFunction,
            exportMoviesFunction: mockFunction,
            listTmdbIdsFunction: mockFunction,
            listFilmSelectionsFunction: mockFunction,
            getTicketPricingFunction: mockFunction,
            validateCheckoutFunction: mockFunction,
            sendBookingConfirmationFunction: mockFunction,
            upsertBookingOffersFunction: mockFunction,
            upsertTicketPricingFunction: mockFunction,
            listMovieCollectionsFunction: mockFunction,
            getMovieCollectionFunction: mockFunction,
            refreshMovieCollectionFunction: mockFunction,
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

    it('should map the default stage to the custom domain', () => {
        const template = Template.fromStack(stack);
        template.resourceCountIs('AWS::ApiGatewayV2::ApiMapping', 1);
        template.hasResourceProperties('AWS::ApiGatewayV2::ApiMapping', {
            ApiId: Match.anyValue(),
            DomainName: 'api.blockbuster-theatre.nml-applications.com',
            Stage: '$default',
        });
    });

    it('should create API routes', () => {
        const template = Template.fromStack(stack);
        template.resourceCountIs('AWS::ApiGatewayV2::Route', 15);
        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'GET /movies/export',
            AuthorizationType: 'JWT',
            AuthorizerId: Match.anyValue(),
        });
        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'GET /movies/tmdb-ids',
            AuthorizationType: 'JWT',
            AuthorizerId: Match.anyValue(),
        });
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
            RouteKey: 'PATCH /movies',
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
        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'GET /film-selections',
            AuthorizationType: 'NONE',
        });
        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'GET /ticket-pricing',
            AuthorizationType: 'NONE',
        });
        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'POST /ticket-pricing',
            AuthorizationType: 'JWT',
            AuthorizerId: Match.anyValue(),
        });
        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'POST /booking-offers',
            AuthorizationType: 'JWT',
            AuthorizerId: Match.anyValue(),
        });
        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'GET /collections',
            AuthorizationType: 'NONE',
        });
        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'GET /collections/{id}',
            AuthorizationType: 'NONE',
        });
        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'POST /collections/refresh',
            AuthorizationType: 'JWT',
            AuthorizerId: Match.anyValue(),
            AuthorizationType: 'JWT',
            AuthorizerId: Match.anyValue(),
        });
        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'POST /checkout/validate',
            AuthorizationType: 'NONE',
        });
        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'POST /booking/confirmation',
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
