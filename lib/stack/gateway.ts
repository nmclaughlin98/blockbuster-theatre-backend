import * as apigw2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

interface ApiGatewayConstructProps {
    addMoviesFunction: lambda.IFunction;
    listMoviesFunction: lambda.IFunction;
    getMovieFunction: lambda.IFunction;
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
                    apigw2.CorsHttpMethod.OPTIONS,
                ],
                allowHeaders: ['Content-Type', 'Authorization'],
            },
        });

        const integration = new integrations.HttpLambdaIntegration(
            'AddMoviesIntegration',
            props.addMoviesFunction
        );
        const listMoviesIntegration = new integrations.HttpLambdaIntegration(
            'ListMoviesIntegration',
            props.listMoviesFunction
        );
        const getMovieIntegration = new integrations.HttpLambdaIntegration(
            'GetMovieIntegration',
            props.getMovieFunction
        );

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
            path: '/movies',
            methods: [apigw2.HttpMethod.POST],
            integration,
        });
    }
}
