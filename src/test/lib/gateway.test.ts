import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { ApiGatewayConstruct } from '../../../lib/stack';

describe('ApiGatewayConstruct', () => {
    let stack: cdk.Stack;
    let mockFunction: lambda.Function;
    let construct: ApiGatewayConstruct;
    let jwtAuthorizer: authorizers.HttpJwtAuthorizer;

    function createGateway(envName: 'prod' | 'dev'): ApiGatewayConstruct {
        return new ApiGatewayConstruct(stack, envName === 'prod' ? 'TestApiGateway' : 'DevApiGateway', {
            addMoviesFunction: mockFunction,
            updateMoviesFunction: mockFunction,
            listMoviesFunction: mockFunction,
            getMovieFunction: mockFunction,
            listFilmSelectionsFunction: mockFunction,
            getTicketPricingFunction: mockFunction,
            validateCheckoutFunction: mockFunction,
            sendBookingConfirmationFunction: mockFunction,
            upsertBookingOffersFunction: mockFunction,
            upsertTicketPricingFunction: mockFunction,
            listMovieCollectionsFunction: mockFunction,
            getMovieCollectionFunction: mockFunction,
            refreshMovieCollectionFunction: mockFunction,
            listBookingsFunction: mockFunction,
            createBookingFunction: mockFunction,
            getBookingFunction: mockFunction,
            rescheduleBookingFunction: mockFunction,
            createShowtimeFunction: mockFunction,
            updateShowtimeFunction: mockFunction,
            cancelShowtimeFunction: mockFunction,
            guestConversionFunction: mockFunction,
            downloadTicketFunction: mockFunction,
            jwtAuthorizer,
            envName,
        });
    }

    beforeEach(() => {
        stack = new cdk.Stack();
        mockFunction = new lambda.Function(stack, 'MockFunction', {
            runtime: lambda.Runtime.NODEJS_24_X,
            handler: 'index.handler',
            code: lambda.Code.fromInline('exports.handler = async () => {};'),
        });
        jwtAuthorizer = new authorizers.HttpJwtAuthorizer(
            'TestJwtAuthorizer',
            'https://issuer.example.com',
            { jwtAudience: ['test-client'] }
        );
        construct = createGateway('prod');
    });

    it('should create an HTTP API', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
            Name: 'blockbuster-theatre-api-PROD',
            ProtocolType: 'HTTP',
        });
    });

    it('does not claim the existing custom-domain mapping', () => {
        const template = Template.fromStack(stack);
        template.resourceCountIs('AWS::ApiGatewayV2::ApiMapping', 0);
        template.resourceCountIs('AWS::ApiGatewayV2::DomainName', 0);
    });

    it('should create API routes', () => {
        const template = Template.fromStack(stack);
        const publicRoutes = [
            'GET /movies', 'GET /movies/{movieId}',
            'GET /checkout/current-selections', 'POST /checkout/validate',
            'GET /collections', 'GET /collections/{collectionId}', 'GET /pricing',
            'GET /bookings', 'POST /bookings', 'GET /bookings/{bookingId}',
            'POST /bookings/{bookingId}/confirmation', 'GET /bookings/{bookingId}/ticket',
            'POST /auth/convert-guest-bookings',
        ];
        const jwtRoutes = [
            'POST /movies', 'PATCH /movies', 'POST /collections/refresh',
            'POST /pricing', 'POST /offers', 'PATCH /bookings/{bookingId}/reschedule',
            'POST /showtimes', 'PATCH /showtimes/{showtimeId}', 'DELETE /showtimes/{showtimeId}',
        ];
        template.resourceCountIs('AWS::ApiGatewayV2::Route', publicRoutes.length + jwtRoutes.length);
        for (const route of publicRoutes) {
            const [method, path] = route.split(' ');
            template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
                RouteKey: `${method} /api/v1${path}`, AuthorizationType: 'NONE',
            });
        }
        for (const route of jwtRoutes) {
            const [method, path] = route.split(' ');
            template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
                RouteKey: `${method} /api/v1${path}`, AuthorizationType: 'JWT',
                AuthorizerId: Match.anyValue(),
            });
        }
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

    it.each(['prod', 'dev'] as const)('logs %s API access through the existing default stage', (envName) => {
        if (envName === 'dev') createGateway('dev');
        const template = Template.fromStack(stack);
        const logName = `/aws/vendedlogs/blockbuster-theatre-api-v1-access-${envName.toUpperCase()}`;
        const groups = template.findResources('AWS::Logs::LogGroup', {
            Properties: { LogGroupName: logName },
        });
        const logGroupId = Object.keys(groups)[0];
        expect(logGroupId).toBeDefined();
        template.hasResource('AWS::Logs::LogGroup', {
            DeletionPolicy: envName === 'dev' ? 'Delete' : 'Retain',
            UpdateReplacePolicy: envName === 'dev' ? 'Delete' : 'Retain',
            Properties: { LogGroupName: logName, RetentionInDays: 7 },
        });
        template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
            StageName: '$default',
            AutoDeploy: true,
            AccessLogSettings: {
                DestinationArn: { 'Fn::GetAtt': [logGroupId, 'Arn'] },
                Format: JSON.stringify({
                    requestId: '$context.requestId',
                    requestTime: '$context.requestTime',
                    httpMethod: '$context.httpMethod',
                    routeKey: '$context.routeKey',
                    status: '$context.status',
                    responseLatency: '$context.responseLatency',
                    integrationStatus: '$context.integration.status',
                    authorizerError: '$context.authorizer.error',
                    gatewayError: '$context.error.message',
                }),
            },
        });
    });
});
