import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {
    ApiGatewayConstruct,
    AuthenticationConstruct,
    DatabaseConstruct,
    LambdaConstruct,
} from './stack';

export class BlockbusterTheatreBackendStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // 1. Instantiate DynamoDB
        const database = new DatabaseConstruct(this, 'MoviesDatabase');
        const authentication = new AuthenticationConstruct(this, 'Authentication');

        // 2. Instantiate Lambda & pass DB table
        const lambdaServices = new LambdaConstruct(this, 'AddMoviesLambda', {
            table: database.table,
        });

        // 3. Instantiate API Gateway & pass Lambda handler
        const apiGateway = new ApiGatewayConstruct(this, 'ApiGateway', {
            addMoviesFunction: lambdaServices.addMoviesFunction,
            listMoviesFunction: lambdaServices.listMoviesFunction,
            getMovieFunction: lambdaServices.getMovieFunction,
            jwtAuthorizer: authentication.jwtAuthorizer,
        });

        // Output backend endpoint for client apps
        new cdk.CfnOutput(this, 'ApiEndpoint', {
            value: apiGateway.httpApi.url!,
            description: 'Base HTTP endpoint for WinForms, WinUI 3, SwiftUI, and Web SPA',
        });
        new cdk.CfnOutput(this, 'UserPoolId', {
            value: authentication.userPool.userPoolId,
            description: 'Cognito user pool ID for frontend authentication',
        });
        new cdk.CfnOutput(this, 'UserPoolClientId', {
            value: authentication.userPoolClient.userPoolClientId,
            description: 'Cognito public app client ID for frontend authentication',
        });
        new cdk.CfnOutput(this, 'UserPoolIssuer', {
            value: `https://cognito-idp.${this.region}.amazonaws.com/${authentication.userPool.userPoolId}`,
            description: 'JWT issuer configured on the API Gateway authorizer',
        });
    }
}