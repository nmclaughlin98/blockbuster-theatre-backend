import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import { movieImportLambdaConfig as cfg } from '../../../lib/stack/lambda';

interface LambdaConstructProps {
    table: dynamodb.Table;
}

export class LambdaConstruct extends Construct {
    public readonly addMoviesFunction: lambdaNodejs.NodejsFunction;

    constructor(scope: Construct, id: string, props: LambdaConstructProps) {
        super(scope, id);

        this.addMoviesFunction = new lambdaNodejs.NodejsFunction(this, 'AddMoviesHandler', {
            functionName: 'blockbuster-theatre-add-movies-lambda',
            runtime: lambda.Runtime.NODEJS_24_X,
            entry: path.join(__dirname, './handlers/add-movies-handler.ts'),
            handler: 'handler',
            memorySize: cfg.memorySize,
            timeout: cdk.Duration.seconds(cfg.timeoutSeconds),
            reservedConcurrentExecutions: cfg.reservedConcurrentExecutions,
            environment: {
                TABLE_NAME: props.table.tableName,
                TMDB_API_KEY: process.env.TMDB_API_KEY ?? '',
                MAX_BATCH: String(cfg.maxBatch),
                TMDB_CONCURRENCY: String(cfg.tmdbConcurrency),
                TMDB_TIMEOUT_MS: String(cfg.tmdbTimeoutMs),
                TMDB_RETRIES: String(cfg.tmdbRetries),
            },
        });

        props.table.grantReadWriteData(this.addMoviesFunction);
    }
}