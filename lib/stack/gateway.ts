import * as apigw2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { RemovalPolicy } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { resourceName, type EnvironmentName } from './environment';

interface ApiGatewayConstructProps {
    addMoviesFunction: lambda.IFunction;
    updateMoviesFunction: lambda.IFunction;
    listMoviesFunction: lambda.IFunction;
    listFeaturedMoviesFunction: lambda.IFunction;
    getMovieFunction: lambda.IFunction;
    exportMoviesFunction: lambda.IFunction;
    listTmdbIdsFunction: lambda.IFunction;
    listFilmSelectionsFunction: lambda.IFunction;
    getTicketPricingFunction: lambda.IFunction;
    validateCheckoutFunction: lambda.IFunction;
    sendBookingConfirmationFunction: lambda.IFunction;
    upsertBookingOffersFunction: lambda.IFunction;
    upsertTicketPricingFunction: lambda.IFunction;
    listMovieCollectionsFunction: lambda.IFunction;
    getMovieCollectionFunction: lambda.IFunction;
    refreshMovieCollectionFunction: lambda.IFunction;
    listBookingsFunction: lambda.IFunction;
    createBookingFunction: lambda.IFunction;
    rescheduleBookingFunction: lambda.IFunction;
    manageShowtimesFunction: lambda.IFunction;
    guestBookedSeatsFunction: lambda.IFunction;
    guestBookingFunction: lambda.IFunction;
    guestConversionFunction: lambda.IFunction;
    downloadTicketFunction: lambda.IFunction;
    jwtAuthorizer: authorizers.HttpJwtAuthorizer;
    envName?: EnvironmentName;
}

export class ApiGatewayConstruct extends Construct {
    public readonly httpApi: apigw2.HttpApi;

    constructor(scope: Construct, id: string, props: ApiGatewayConstructProps) {
        super(scope, id);
        const envName = props.envName ?? 'prod';
        const isDev = envName === 'dev';

        this.httpApi = new apigw2.HttpApi(this, 'HttpApi', {
            apiName: resourceName('blockbuster-theatre-api-gateway', envName),
            corsPreflight: {
                allowOrigins: !isDev
                    ? [
                        'https://blockbuster-theatre.nml-applications.com',
                        'https://*',
                        'http://localhost:3000',
                        'http://localhost:4173',
                        'http://localhost:5173',
                        'http://127.0.0.1:3000',
                        'http://127.0.0.1:4173',
                        'http://127.0.0.1:5173',
                    ]
                    : ['*'],
                allowMethods: !isDev
                    ? [
                        apigw2.CorsHttpMethod.GET,
                        apigw2.CorsHttpMethod.POST,
                        apigw2.CorsHttpMethod.PUT,
                        apigw2.CorsHttpMethod.PATCH,
                        apigw2.CorsHttpMethod.OPTIONS,
                    ]
                    : [
                        apigw2.CorsHttpMethod.GET,
                        apigw2.CorsHttpMethod.POST,
                        apigw2.CorsHttpMethod.PUT,
                        apigw2.CorsHttpMethod.PATCH,
                        apigw2.CorsHttpMethod.DELETE,
                        apigw2.CorsHttpMethod.OPTIONS,
                    ],
                allowHeaders: ['Content-Type', 'Authorization'],
            },
        });

        const accessLogGroup = new logs.LogGroup(this, 'AccessLogGroup', {
            logGroupName: resourceName('/aws/vendedlogs/blockbuster-theatre-api-access', envName),
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy: isDev ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
        });
        const defaultStage = this.httpApi.defaultStage?.node.defaultChild;
        if (!(defaultStage instanceof apigw2.CfnStage)) {
            throw new Error('HTTP API default stage is required for access logging.');
        }
        defaultStage.accessLogSettings = {
            destinationArn: accessLogGroup.logGroupArn,
            format: JSON.stringify({
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
        };

        const customDomainName = isDev
            ? 'api-dev.blockbuster-theatre.nml-applications.com'
            : 'api.blockbuster-theatre.nml-applications.com';
        const customDomain = apigw2.CfnDomainName.fromDomainName(
            this,
            'ImportedCustomDomain',
            customDomainName
        );

        new apigw2.ApiMapping(this, 'ApiMapping', {
            api: this.httpApi,
            domainName: customDomain,
        });

        const integration = new integrations.HttpLambdaIntegration(
            'AddMoviesIntegration',
            props.addMoviesFunction
        );
        const updateMoviesIntegration = new integrations.HttpLambdaIntegration(
            'UpdateMoviesIntegration',
            props.updateMoviesFunction
        );
        const listMoviesIntegration = new integrations.HttpLambdaIntegration(
            'ListMoviesIntegration',
            props.listMoviesFunction
        );
        const listFeaturedMoviesIntegration = new integrations.HttpLambdaIntegration(
            'ListFeaturedMoviesIntegration',
            props.listFeaturedMoviesFunction
        );
        const getMovieIntegration = new integrations.HttpLambdaIntegration(
            'GetMovieIntegration',
            props.getMovieFunction
        );
        const exportMoviesIntegration = new integrations.HttpLambdaIntegration(
            'ExportMoviesIntegration',
            props.exportMoviesFunction
        );
        const listTmdbIdsIntegration = new integrations.HttpLambdaIntegration(
            'ListTmdbIdsIntegration',
            props.listTmdbIdsFunction
        );
        const listFilmSelectionsIntegration = new integrations.HttpLambdaIntegration(
            'ListFilmSelectionsIntegration',
            props.listFilmSelectionsFunction
        );
        const getTicketPricingIntegration = new integrations.HttpLambdaIntegration(
            'GetTicketPricingIntegration',
            props.getTicketPricingFunction
        );
        const validateCheckoutIntegration = new integrations.HttpLambdaIntegration(
            'ValidateCheckoutIntegration',
            props.validateCheckoutFunction
        );
        const sendBookingConfirmationIntegration = new integrations.HttpLambdaIntegration(
            'SendBookingConfirmationIntegration',
            props.sendBookingConfirmationFunction
        );
        const upsertBookingOffersIntegration = new integrations.HttpLambdaIntegration(
            'UpsertBookingOffersIntegration',
            props.upsertBookingOffersFunction
        );
        const upsertTicketPricingIntegration = new integrations.HttpLambdaIntegration(
            'UpsertTicketPricingIntegration',
            props.upsertTicketPricingFunction
        );
        const getMovieCollectionIntegration = new integrations.HttpLambdaIntegration(
            'GetMovieCollectionIntegration',
            props.getMovieCollectionFunction
        );
        const listMovieCollectionsIntegration = new integrations.HttpLambdaIntegration(
            'ListMovieCollectionsIntegration',
            props.listMovieCollectionsFunction
        );
        const refreshMovieCollectionIntegration = new integrations.HttpLambdaIntegration(
            'RefreshMovieCollectionIntegration',
            props.refreshMovieCollectionFunction
        );
        const listBookingsIntegration = new integrations.HttpLambdaIntegration(
            'ListBookingsIntegration',
            props.listBookingsFunction
        );
        const createBookingIntegration = new integrations.HttpLambdaIntegration(
            'CreateBookingIntegration',
            props.createBookingFunction
        );
        const rescheduleBookingIntegration = new integrations.HttpLambdaIntegration(
            'RescheduleCustomerBookingIntegration',
            props.rescheduleBookingFunction
        );
        const manageShowtimesIntegration = new integrations.HttpLambdaIntegration(
            'ManageShowtimesIntegration',
            props.manageShowtimesFunction
        );
        const guestBookedSeatsIntegration = new integrations.HttpLambdaIntegration(
            'GuestBookedSeatsIntegration',
            props.guestBookedSeatsFunction
        );
        const guestBookingIntegration = new integrations.HttpLambdaIntegration(
            'GuestBookingIntegration',
            props.guestBookingFunction
        );
        const guestConversionIntegration = new integrations.HttpLambdaIntegration(
            'GuestConversionIntegration',
            props.guestConversionFunction
        );
        const downloadTicketIntegration = new integrations.HttpLambdaIntegration(
            'DownloadTicketIntegration',
            props.downloadTicketFunction
        );

        this.httpApi.addRoutes({
            path: '/film-selections',
            methods: [apigw2.HttpMethod.GET],
            integration: listFilmSelectionsIntegration,
        });

        this.httpApi.addRoutes({
            path: '/ticket-pricing',
            methods: [apigw2.HttpMethod.GET],
            integration: getTicketPricingIntegration,
        });

        this.httpApi.addRoutes({
            path: '/ticket-pricing',
            methods: [apigw2.HttpMethod.POST],
            integration: upsertTicketPricingIntegration,
            authorizer: props.jwtAuthorizer,
        });

        this.httpApi.addRoutes({
            path: '/booking-offers',
            methods: [apigw2.HttpMethod.POST],
            integration: upsertBookingOffersIntegration,
            authorizer: props.jwtAuthorizer,
        });

        this.httpApi.addRoutes({
            path: '/checkout/validate',
            methods: [apigw2.HttpMethod.POST],
            integration: validateCheckoutIntegration,
        });

        this.httpApi.addRoutes({
            path: '/booking/confirmation',
            methods: [apigw2.HttpMethod.POST],
            integration: sendBookingConfirmationIntegration,
        });

        this.httpApi.addRoutes({
            path: '/movies',
            methods: [apigw2.HttpMethod.GET],
            integration: listMoviesIntegration,
        });

        this.httpApi.addRoutes({
            path: '/movies/newest',
            methods: [apigw2.HttpMethod.GET],
            integration: listFeaturedMoviesIntegration,
        });

        this.httpApi.addRoutes({
            path: '/movies/top-picks',
            methods: [apigw2.HttpMethod.GET],
            integration: listFeaturedMoviesIntegration,
        });

        this.httpApi.addRoutes({
            path: '/movies/{id}',
            methods: [apigw2.HttpMethod.GET],
            integration: getMovieIntegration,
        });

        this.httpApi.addRoutes({
            path: '/movies/export',
            methods: [apigw2.HttpMethod.GET],
            integration: exportMoviesIntegration,
            authorizer: props.jwtAuthorizer,
        });

        this.httpApi.addRoutes({
            path: '/movies/tmdb-ids',
            methods: [apigw2.HttpMethod.GET],
            integration: listTmdbIdsIntegration,
            authorizer: props.jwtAuthorizer,
        });

        this.httpApi.addRoutes({
            path: '/movies',
            methods: [apigw2.HttpMethod.POST],
            integration,
            authorizer: props.jwtAuthorizer,
        });

        this.httpApi.addRoutes({
            path: '/movies',
            methods: [apigw2.HttpMethod.PATCH],
            integration: updateMoviesIntegration,
            authorizer: props.jwtAuthorizer,
        });

        this.httpApi.addRoutes({
            path: '/collections',
            methods: [apigw2.HttpMethod.GET],
            integration: listMovieCollectionsIntegration,
        });

        this.httpApi.addRoutes({
            path: '/collections/{id}',
            methods: [apigw2.HttpMethod.GET],
            integration: getMovieCollectionIntegration,
        });

        this.httpApi.addRoutes({
            path: '/collections/refresh',
            methods: [apigw2.HttpMethod.POST],
            integration: refreshMovieCollectionIntegration,
            authorizer: props.jwtAuthorizer,
        });

        this.httpApi.addRoutes({
            path: '/bookings',
            methods: [apigw2.HttpMethod.GET],
            integration: listBookingsIntegration,
        });

        // Unauthenticated until the login system exists; the user ID is generated server-side for now.
        this.httpApi.addRoutes({
            path: '/bookings',
            methods: [apigw2.HttpMethod.POST],
            integration: createBookingIntegration,
        });

        this.httpApi.addRoutes({
            path: '/bookings/reschedule-booking',
            methods: [apigw2.HttpMethod.PATCH],
            integration: rescheduleBookingIntegration,
        });

        this.httpApi.addRoutes({
            path: '/showtimes',
            methods: [apigw2.HttpMethod.POST],
            integration: manageShowtimesIntegration,
            authorizer: props.jwtAuthorizer,
        });

        this.httpApi.addRoutes({
            path: '/showtimes/{showtimeId}',
            methods: [apigw2.HttpMethod.PATCH, apigw2.HttpMethod.DELETE],
            integration: manageShowtimesIntegration,
            authorizer: props.jwtAuthorizer,
        });

        this.httpApi.addRoutes({
            path: '/api/v1/bookings/guest',
            methods: [apigw2.HttpMethod.GET],
            integration: guestBookedSeatsIntegration,
        });

        this.httpApi.addRoutes({
            path: '/api/v1/bookings/guest',
            methods: [apigw2.HttpMethod.POST],
            integration: guestBookingIntegration,
        });

        this.httpApi.addRoutes({
            path: '/api/v1/bookings/account',
            methods: [apigw2.HttpMethod.GET],
            integration: guestBookedSeatsIntegration,
            authorizer: props.jwtAuthorizer,
        });

        this.httpApi.addRoutes({
            path: '/api/v1/bookings/account/history',
            methods: [apigw2.HttpMethod.GET],
            integration: guestBookedSeatsIntegration,
            authorizer: props.jwtAuthorizer,
        });

        this.httpApi.addRoutes({
            path: '/api/v1/bookings/account',
            methods: [apigw2.HttpMethod.POST],
            integration: guestBookingIntegration,
            authorizer: props.jwtAuthorizer,
        });

        this.httpApi.addRoutes({
            path: '/api/v1/auth/convert-guest',
            methods: [apigw2.HttpMethod.POST],
            integration: guestConversionIntegration,
        });

        this.httpApi.addRoutes({
            path: '/bookings/{bookingId}/ticket',
            methods: [apigw2.HttpMethod.GET],
            integration: downloadTicketIntegration,
            authorizer: props.jwtAuthorizer,
        });
    }
}