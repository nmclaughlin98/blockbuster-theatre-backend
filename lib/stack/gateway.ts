import * as apigw2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

interface ApiGatewayConstructProps {
    addMoviesFunction: lambda.IFunction;
    updateMoviesFunction: lambda.IFunction;
    listMoviesFunction: lambda.IFunction;
    getMovieFunction: lambda.IFunction;
    exportMoviesFunction: lambda.IFunction;
    listTmdbIdsFunction: lambda.IFunction;
    listFilmSelectionsFunction: lambda.IFunction;
    getTicketPricingFunction: lambda.IFunction;
    validateCheckoutFunction: lambda.IFunction;
    upsertBookingOffersFunction: lambda.IFunction;
    upsertTicketPricingFunction: lambda.IFunction;
    listMovieCollectionsFunction: lambda.IFunction;
    getMovieCollectionFunction: lambda.IFunction;
    refreshMovieCollectionFunction: lambda.IFunction;
    jwtAuthorizer: authorizers.HttpJwtAuthorizer;
}

export class ApiGatewayConstruct extends Construct {
    public readonly httpApi: apigw2.HttpApi;

    constructor(scope: Construct, id: string, props: ApiGatewayConstructProps) {
        super(scope, id);

        this.httpApi = new apigw2.HttpApi(this, 'HttpApi', {
            apiName: 'blockbuster-theatre-api-gateway',
            corsPreflight: {
                allowOrigins: ['*'],
                allowMethods: [
                    apigw2.CorsHttpMethod.GET,
                    apigw2.CorsHttpMethod.POST,
                    apigw2.CorsHttpMethod.PATCH,
                    apigw2.CorsHttpMethod.OPTIONS,
                ],
                allowHeaders: ['Content-Type', 'Authorization'],
            },
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
            path: '/movies',
            methods: [apigw2.HttpMethod.GET],
            integration: listMoviesIntegration,
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
            path: '/collections/{id}/refresh',
            methods: [apigw2.HttpMethod.POST],
            integration: refreshMovieCollectionIntegration,
            authorizer: props.jwtAuthorizer,
        });
    }
}
