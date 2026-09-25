import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';

interface LambdaConstructProps {
    table: dynamodb.Table;
}

export class LambdaConstruct extends Construct {
    public readonly manageItemsFunction: lambdaNodejs.NodejsFunction;

    constructor(scope: Construct, id: string, props: LambdaConstructProps) {
        super(scope, id);

        // Descriptive name for the Lambda handler resource
        this.manageItemsFunction = new lambdaNodejs.NodejsFunction(this, 'ManageItemsHandler', {
            functionName: 'BlockbusterTheatre-ManageItems',
            runtime: lambda.Runtime.NODEJS_24_X,
            entry: path.join(__dirname, './handlers/add-movies.ts'),
            handler: 'handler',
            memorySize: 128,
            timeout: cdk.Duration.seconds(5),
            environment: {
                TABLE_NAME: props.table.tableName,
            },
        });

        // Grant DynamoDB access to Lambda
        props.table.grantReadWriteData(this.manageItemsFunction);
    }
}
