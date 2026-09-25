import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { ApiGatewayConstruct, DatabaseConstruct, LambdaConstruct } from './stack';

export class BackendStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // 1. Instantiate DynamoDB
        const database = new DatabaseConstruct(this, 'Database');

        // 2. Instantiate Lambda & pass DB table
        const lambdaServices = new LambdaConstruct(this, 'LambdaServices', {
            table: database.table,
        });

        // 3. Instantiate API Gateway & pass Lambda handler
        const apiGateway = new ApiGatewayConstruct(this, 'ApiGateway', {
            manageItemsFunction: lambdaServices.manageItemsFunction,
        });

        // Output backend endpoint for client apps
        new cdk.CfnOutput(this, 'ApiEndpoint', {
            value: apiGateway.httpApi.url!,
            description: 'Base HTTP endpoint for WinForms, WinUI 3, SwiftUI, and Web SPA',
        });
    }
}