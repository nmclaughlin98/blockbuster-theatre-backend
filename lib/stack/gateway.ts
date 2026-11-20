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
    getMovieFunction: lambda.IFunction;
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
    getBookingFunction: lambda.IFunction;
    rescheduleBookingFunction: lambda.IFunction;
    createShowtimeFunction: lambda.IFunction;
    updateShowtimeFunction: lambda.IFunction;
    cancelShowtimeFunction: lambda.IFunction;
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
            apiName: resourceName('blockbuster-theatre-api', envName),
            corsPreflight: {
                allowOrigins: isDev ? ['*'] : [
                    'https://blockbuster-theatre.nml-applications.com',
                    'https://*',
                    'http://localhost:3000', 'http://localhost:4173', 'http://localhost:5173',
                    'http://127.0.0.1:3000', 'http://127.0.0.1:4173', 'http://127.0.0.1:5173',
                ],
                allowMethods: [
                    apigw2.CorsHttpMethod.GET, apigw2.CorsHttpMethod.POST,
                    apigw2.CorsHttpMethod.PUT, apigw2.CorsHttpMethod.PATCH,
                    apigw2.CorsHttpMethod.DELETE, apigw2.CorsHttpMethod.OPTIONS,
                ],
                allowHeaders: ['Content-Type', 'Authorization'],
            },
        });
        const accessLogGroup = new logs.LogGroup(this, 'AccessLogGroup', {
            logGroupName: resourceName('/aws/vendedlogs/blockbuster-theatre-api-v1-access', envName),
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy: isDev ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
        });
        const defaultStage = this.httpApi.defaultStage?.node.defaultChild;
        if (!(defaultStage instanceof apigw2.CfnStage)) throw new Error('HTTP API default stage is required for access logging.');
        defaultStage.accessLogSettings = {
            destinationArn: accessLogGroup.logGroupArn,
            format: JSON.stringify({
                requestId: '$context.requestId', requestTime: '$context.requestTime',
                httpMethod: '$context.httpMethod', routeKey: '$context.routeKey',
                status: '$context.status', responseLatency: '$context.responseLatency',
                integrationStatus: '$context.integration.status', authorizerError: '$context.authorizer.error',
                gatewayError: '$context.error.message',
            }),
        };

        const routes: Array<[string, apigw2.HttpMethod, lambda.IFunction, boolean]> = [
            ['/movies', apigw2.HttpMethod.GET, props.listMoviesFunction, false],
            ['/movies', apigw2.HttpMethod.POST, props.addMoviesFunction, true],
            ['/movies', apigw2.HttpMethod.PATCH, props.updateMoviesFunction, true],
            ['/movies/{movieId}', apigw2.HttpMethod.GET, props.getMovieFunction, false],
            ['/checkout/current-selections', apigw2.HttpMethod.GET, props.listFilmSelectionsFunction, false],
            ['/checkout/validate', apigw2.HttpMethod.POST, props.validateCheckoutFunction, false],
            ['/collections', apigw2.HttpMethod.GET, props.listMovieCollectionsFunction, false],
            ['/collections/{collectionId}', apigw2.HttpMethod.GET, props.getMovieCollectionFunction, false],
            ['/collections/refresh', apigw2.HttpMethod.POST, props.refreshMovieCollectionFunction, true],
            ['/pricing', apigw2.HttpMethod.GET, props.getTicketPricingFunction, false],
            ['/pricing', apigw2.HttpMethod.POST, props.upsertTicketPricingFunction, true],
            ['/offers', apigw2.HttpMethod.POST, props.upsertBookingOffersFunction, true],
            ['/bookings', apigw2.HttpMethod.GET, props.listBookingsFunction, false],
            ['/bookings', apigw2.HttpMethod.POST, props.createBookingFunction, false],
            ['/bookings/{bookingId}', apigw2.HttpMethod.GET, props.getBookingFunction, false],
            ['/bookings/{bookingId}/reschedule', apigw2.HttpMethod.PATCH, props.rescheduleBookingFunction, true],
            ['/bookings/{bookingId}/confirmation', apigw2.HttpMethod.POST, props.sendBookingConfirmationFunction, false],
            ['/bookings/{bookingId}/ticket', apigw2.HttpMethod.GET, props.downloadTicketFunction, false],
            ['/auth/convert-guest-bookings', apigw2.HttpMethod.POST, props.guestConversionFunction, false],
            ['/showtimes', apigw2.HttpMethod.POST, props.createShowtimeFunction, true],
            ['/showtimes/{showtimeId}', apigw2.HttpMethod.PATCH, props.updateShowtimeFunction, true],
            ['/showtimes/{showtimeId}', apigw2.HttpMethod.DELETE, props.cancelShowtimeFunction, true],
        ];
        routes.forEach(([path, method, fn, requiresJwt], index) => {
            this.httpApi.addRoutes({
                path: `/api/v1${path}`, methods: [method],
                integration: new integrations.HttpLambdaIntegration(`Route${index}Integration`, fn),
                ...(requiresJwt && { authorizer: props.jwtAuthorizer }),
            });
        });
    }
}
