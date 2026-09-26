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
    public readonly listMoviesFunction: lambdaNodejs.NodejsFunction;
    public readonly getMovieFunction: lambdaNodejs.NodejsFunction;

    /**
     * Creates the movie import, list, and detail Lambda functions with table permissions.
     * @param scope Parent CDK construct.
     * @param id Construct identifier.
     * @param props DynamoDB table and optional import Lambda configuration.
     */
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

        this.listMoviesFunction = new lambdaNodejs.NodejsFunction(this, 'ListMoviesHandler', {
            functionName: 'blockbuster-theatre-list-movies-lambda',
            runtime: lambda.Runtime.NODEJS_24_X,
            entry: path.join(__dirname, './handlers/list-movies-handler.ts'),
            handler: 'handler',
            memorySize: 256,
            timeout: cdk.Duration.seconds(10),
            environment: {
                TABLE_NAME: props.table.tableName,
            },
        });

        props.table.grantReadData(this.listMoviesFunction);

        this.getMovieFunction = new lambdaNodejs.NodejsFunction(this, 'GetMovieHandler', {
            functionName: 'blockbuster-theatre-get-movie-lambda',
            runtime: lambda.Runtime.NODEJS_24_X,
            entry: path.join(__dirname, './handlers/get-movie-handler.ts'),
            handler: 'handler',
            memorySize: 256,
            timeout: cdk.Duration.seconds(10),
            environment: {
                TABLE_NAME: props.table.tableName,
            },
        });

        props.table.grantReadData(this.getMovieFunction);
    }
}