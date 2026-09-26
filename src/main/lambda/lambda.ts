import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import { movieImportLambdaConfig as cfg, type MovieImportLambdaConfig } from '../../../lib/stack/lambda';

interface LambdaConstructProps {
    table: dynamodb.Table;
    lambdaConfig?: MovieImportLambdaConfig;
}

export class LambdaConstruct extends Construct {
    public readonly addMoviesFunction: lambdaNodejs.NodejsFunction;

    constructor(scope: Construct, id: string, props: LambdaConstructProps) {
        super(scope, id);
        const lambdaConfig = props.lambdaConfig ?? cfg;

        this.addMoviesFunction = new lambdaNodejs.NodejsFunction(this, 'AddMoviesHandler', {
            functionName: 'blockbuster-theatre-add-movies-lambda',
            runtime: lambda.Runtime.NODEJS_24_X,
            entry: path.join(__dirname, './handlers/add-movies-handler.ts'),
            handler: 'handler',
            memorySize: lambdaConfig.memorySize,
            timeout: cdk.Duration.seconds(lambdaConfig.timeoutSeconds),
            ...(lambdaConfig.reservedConcurrentExecutions !== undefined && {
                reservedConcurrentExecutions: lambdaConfig.reservedConcurrentExecutions,
            }),
            environment: {
                TABLE_NAME: props.table.tableName,
                TMDB_API_KEY: process.env.TMDB_API_KEY ?? '',
                MAX_BATCH: String(lambdaConfig.maxBatch),
                TMDB_CONCURRENCY: String(lambdaConfig.tmdbConcurrency),
                TMDB_TIMEOUT_MS: String(lambdaConfig.tmdbTimeoutMs),
                TMDB_RETRIES: String(lambdaConfig.tmdbRetries),
            },
        });

        props.table.grantReadWriteData(this.addMoviesFunction);
    }
}