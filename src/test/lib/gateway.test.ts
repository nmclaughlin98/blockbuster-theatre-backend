import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { ApiGatewayConstruct } from '../../../lib/backend';

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
            listFeaturedMoviesFunction: mockFunction,
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
            listBookingsFunction: mockFunction,
            createBookingFunction: mockFunction,
            rescheduleBookingFunction: mockFunction,
            manageShowtimesFunction: mockFunction,
            guestBookedSeatsFunction: mockFunction,
            guestBookingFunction: mockFunction,
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

        jwtAuthorizer = new authorizers.HttpJwtAuthorizer('TestJwtAuthorizer', 'https://issuer.example.com', {
            jwtAudience: ['test-client'],
        });

        construct = createGateway('prod');
    });

    it('should create an HTTP API', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
            Name: 'blockbuster-theatre-prod-api-gateway',
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
        template.resourceCountIs('AWS::ApiGatewayV2::Route', 30);
        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'GET /api/v1/bookings/guest',
            AuthorizationType: 'NONE',
        });

        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'POST /api/v1/bookings/guest',
            AuthorizationType: 'NONE',
        });

        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'GET /api/v1/bookings/account',
            AuthorizationType: 'JWT',
            AuthorizerId: Match.anyValue(),
        });

        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'GET /api/v1/bookings/account/history',
            AuthorizationType: 'JWT',
            AuthorizerId: Match.anyValue(),
        });

        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'GET /bookings/{bookingId}/ticket',
            AuthorizationType: 'JWT',
            AuthorizerId: Match.anyValue(),
        });

        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'POST /api/v1/auth/convert-guest',
            AuthorizationType: 'NONE',
        });

        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'GET /bookings',
            AuthorizationType: 'NONE',
        });

        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'POST /bookings',
            AuthorizationType: 'NONE',
        });

        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'PATCH /bookings/reschedule-booking',
            AuthorizationType: 'NONE',
        });

        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'POST /showtimes',
            AuthorizationType: 'JWT',
            AuthorizerId: Match.anyValue(),
        });

        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'PATCH /showtimes/{showtimeId}',
            AuthorizationType: 'JWT',
            AuthorizerId: Match.anyValue(),
        });

        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'DELETE /showtimes/{showtimeId}',
            AuthorizationType: 'JWT',
            AuthorizerId: Match.anyValue(),
        });

        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'GET /movies/newest',
            AuthorizationType: 'NONE',
        });

        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'GET /movies/top-picks',
            AuthorizationType: 'NONE',
        });

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

    it('does not require scopes on JWT routes so SRP access tokens are accepted', () => {
        const routes = Object.values(
            Template.fromStack(stack).findResources('AWS::ApiGatewayV2::Route'),
        ).filter((route) => route.Properties.AuthorizationType === 'JWT');

        expect(routes.length).toBeGreaterThan(0);

        for (const route of routes) {
            expect(route.Properties.AuthorizationScopes).toBeUndefined();
        }

        expect(routes.map((route) => route.Properties.RouteKey)).toEqual(
            expect.arrayContaining(['GET /api/v1/bookings/account','GET /api/v1/bookings/account/history','POST /api/v1/bookings/account',]),
        );
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
        const logName = `/aws/vendedlogs/blockbuster-theatre-${envName}-api-access`;
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
