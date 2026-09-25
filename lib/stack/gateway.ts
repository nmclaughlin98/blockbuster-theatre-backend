import * as apigw2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

interface ApiGatewayConstructProps {
    addMoivesFunction: lambda.IFunction;
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
            props.addMoivesFunction
        );

        this.httpApi.addRoutes({
            path: '/items/{id}',
            methods: [apigw2.HttpMethod.GET],
            integration,
        });

        this.httpApi.addRoutes({
            path: '/items',
            methods: [apigw2.HttpMethod.POST],
            integration,
        });
    }
}
