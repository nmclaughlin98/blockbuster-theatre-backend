import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import {
    lambdaSettings,
    movieImportLambdaConfig as cfg,
    movieUpdateMaxBatch,
    type MovieImportLambdaConfig,
} from '../../../lib/stack/lambda';

interface LambdaConstructProps {
    table: dynamodb.Table;
    pricingTable: dynamodb.Table;
    offersTable: dynamodb.Table;
    collectionsTable: dynamodb.Table;
    lambdaConfig?: MovieImportLambdaConfig;
}

export class LambdaConstruct extends Construct {
    public readonly addMoviesFunction: lambdaNodejs.NodejsFunction;
    public readonly updateMoviesFunction: lambdaNodejs.NodejsFunction;
    public readonly listMoviesFunction: lambdaNodejs.NodejsFunction;
    public readonly getMovieFunction: lambdaNodejs.NodejsFunction;
    public readonly exportMoviesFunction: lambdaNodejs.NodejsFunction;
    public readonly listTmdbIdsFunction: lambdaNodejs.NodejsFunction;
    public readonly listFilmSelectionsFunction: lambdaNodejs.NodejsFunction;
    public readonly getTicketPricingFunction: lambdaNodejs.NodejsFunction;
    public readonly validateCheckoutFunction: lambdaNodejs.NodejsFunction;
    public readonly upsertBookingOffersFunction: lambdaNodejs.NodejsFunction;
    public readonly upsertTicketPricingFunction: lambdaNodejs.NodejsFunction;
    public readonly getMovieCollectionFunction: lambdaNodejs.NodejsFunction;
    public readonly upsertMovieCollectionsFunction: lambdaNodejs.NodejsFunction;

    /**
     * Creates the movie import, update, list, and detail Lambda functions with table permissions.
     * @param scope Parent CDK construct.
     * @param id Construct identifier.
     * @param props DynamoDB table and optional import Lambda configuration.
     */
    constructor(scope: Construct, id: string, props: LambdaConstructProps) {
        super(scope, id);
        const lambdaConfig = props.lambdaConfig ?? cfg;

        this.addMoviesFunction = new lambdaNodejs.NodejsFunction(this, 'AddMoviesHandler', {
            functionName: 'blockbuster-theatre-add-movies-handler',
            runtime: lambdaSettings.runtime,
            entry: path.join(__dirname, './handlers/add-movies-handler.ts'),
            handler: 'handler',
            memorySize: lambdaConfig.memorySize,
            timeout: cdk.Duration.seconds(lambdaConfig.timeoutSeconds),
            ...(lambdaConfig.reservedConcurrentExecutions !== undefined && {
                reservedConcurrentExecutions: lambdaConfig.reservedConcurrentExecutions,
            }),
            environment: {
                TABLE_NAME: props.table.tableName,
                COLLECTIONS_TABLE_NAME: props.collectionsTable.tableName,
                TMDB_API_KEY: process.env.TMDB_API_KEY ?? '',
                MAX_BATCH: String(lambdaConfig.maxBatch),
                TMDB_CONCURRENCY: String(lambdaConfig.tmdbConcurrency),
                TMDB_TIMEOUT_MS: String(lambdaConfig.tmdbTimeoutMs),
                TMDB_RETRIES: String(lambdaConfig.tmdbRetries),
            },
        });

        props.table.grantReadWriteData(this.addMoviesFunction);
        props.collectionsTable.grantReadWriteData(this.addMoviesFunction);

        this.updateMoviesFunction = new lambdaNodejs.NodejsFunction(this, 'UpdateMoviesHandler', {
            functionName: 'blockbuster-theatre-update-movies-handler',
            runtime: lambdaSettings.runtime,
            entry: path.join(__dirname, './handlers/update-movies-handler.ts'),
            handler: 'handler',
            memorySize: lambdaSettings.batchProcessing.memorySize,
            timeout: cdk.Duration.seconds(lambdaSettings.batchProcessing.timeoutSeconds),
            environment: {
                TABLE_NAME: props.table.tableName,
                MAX_BATCH: String(movieUpdateMaxBatch),
                UPDATE_CONCURRENCY: String(lambdaConfig.tmdbConcurrency),
            },
        });

        props.table.grantReadWriteData(this.updateMoviesFunction);

        this.listMoviesFunction = new lambdaNodejs.NodejsFunction(this, 'ListMoviesHandler', {
            functionName: 'blockbuster-theatre-list-movies-handler',
            runtime: lambdaSettings.runtime,
            entry: path.join(__dirname, './handlers/list-movies-handler.ts'),
            handler: 'handler',
            memorySize: lambdaSettings.default.memorySize,
            timeout: cdk.Duration.seconds(lambdaSettings.default.timeoutSeconds),
            environment: {
                TABLE_NAME: props.table.tableName,
            },
        });

        props.table.grantReadData(this.listMoviesFunction);

        this.getMovieFunction = new lambdaNodejs.NodejsFunction(this, 'GetMovieHandler', {
            functionName: 'blockbuster-theatre-get-movie-lambda',
            runtime: lambdaSettings.runtime,
            entry: path.join(__dirname, './handlers/get-movie-handler.ts'),
            handler: 'handler',
            memorySize: lambdaSettings.default.memorySize,
            timeout: cdk.Duration.seconds(lambdaSettings.default.timeoutSeconds),
            environment: {
                TABLE_NAME: props.table.tableName,
            },
        });

        props.table.grantReadData(this.getMovieFunction);

        this.getMovieCollectionFunction = new lambdaNodejs.NodejsFunction(
            this,
            'GetMovieCollectionHandler',
            {
                functionName: 'blockbuster-theatre-get-movie-collection-handler',
                runtime: lambdaSettings.runtime,
                entry: path.join(__dirname, './handlers/get-movie-collection-handler.ts'),
                handler: 'handler',
                memorySize: lambdaSettings.collectionTreeRead.memorySize,
                timeout: cdk.Duration.seconds(lambdaSettings.collectionTreeRead.timeoutSeconds),
                environment: {
                    TABLE_NAME: props.table.tableName,
                    COLLECTIONS_TABLE_NAME: props.collectionsTable.tableName,
                },
            }
        );

        props.table.grantReadData(this.getMovieCollectionFunction);
        props.collectionsTable.grantReadData(this.getMovieCollectionFunction);

        this.exportMoviesFunction = new lambdaNodejs.NodejsFunction(this, 'ExportMoviesHandler', {
            functionName: 'blockbuster-theatre-export-movies-handler',
            runtime: lambdaSettings.runtime,
            entry: path.join(__dirname, './handlers/export-movies-handler.ts'),
            handler: 'handler',
            memorySize: lambdaSettings.fullTableExport.memorySize,
            timeout: cdk.Duration.seconds(lambdaSettings.fullTableExport.timeoutSeconds),
            environment: {
                TABLE_NAME: props.table.tableName,
            },
        });

        props.table.grantReadData(this.exportMoviesFunction);

        this.listTmdbIdsFunction = new lambdaNodejs.NodejsFunction(this, 'ListTmdbIdsHandler', {
            functionName: 'blockbuster-theatre-list-tmdb-ids-lambda',
            runtime: lambdaSettings.runtime,
            entry: path.join(__dirname, './handlers/list-tmdb-ids-handler.ts'),
            handler: 'handler',
            memorySize: lambdaSettings.fullTableRead.memorySize,
            timeout: cdk.Duration.seconds(lambdaSettings.fullTableRead.timeoutSeconds),
            environment: {
                TABLE_NAME: props.table.tableName,
            },
        });

        props.table.grantReadData(this.listTmdbIdsFunction);

        this.listFilmSelectionsFunction = new lambdaNodejs.NodejsFunction(
            this,
            'ListFilmSelectionsHandler',
            {
                functionName: 'blockbuster-theatre-film-selections-handler',
                runtime: lambdaSettings.runtime,
                entry: path.join(__dirname, './handlers/list-film-selections-handler.ts'),
                handler: 'handler',
                memorySize: lambdaSettings.paginatedSelectionRead.memorySize,
                timeout: cdk.Duration.seconds(lambdaSettings.paginatedSelectionRead.timeoutSeconds),
                environment: {
                    TABLE_NAME: props.table.tableName,
                    OFFERS_TABLE_NAME: props.offersTable.tableName,
                },
            }
        );

        props.table.grantReadData(this.listFilmSelectionsFunction);
        props.offersTable.grantReadData(this.listFilmSelectionsFunction);

        this.getTicketPricingFunction = new lambdaNodejs.NodejsFunction(
            this,
            'GetTicketPricingHandler',
            {
                functionName: 'blockbuster-theatre-ticket-pricing-handler',
                runtime: lambdaSettings.runtime,
                entry: path.join(__dirname, './handlers/get-ticket-pricing-handler.ts'),
                handler: 'handler',
                memorySize: lambdaSettings.default.memorySize,
                timeout: cdk.Duration.seconds(lambdaSettings.default.timeoutSeconds),
                environment: {
                    TABLE_NAME: props.table.tableName,
                    PRICING_TABLE_NAME: props.pricingTable.tableName,
                    OFFERS_TABLE_NAME: props.offersTable.tableName,
                },
            }
        );

        props.table.grantReadData(this.getTicketPricingFunction);
        props.pricingTable.grantReadData(this.getTicketPricingFunction);
        props.offersTable.grantReadData(this.getTicketPricingFunction);

        this.validateCheckoutFunction = new lambdaNodejs.NodejsFunction(
            this,
            'ValidateCheckoutHandler',
            {
                functionName: 'blockbuster-theatre-checkout-validation-handler',
                runtime: lambdaSettings.runtime,
                entry: path.join(__dirname, './handlers/validate-checkout-handler.ts'),
                handler: 'handler',
                memorySize: lambdaSettings.default.memorySize,
                timeout: cdk.Duration.seconds(lambdaSettings.default.timeoutSeconds),
                environment: {
                    TABLE_NAME: props.table.tableName,
                    PRICING_TABLE_NAME: props.pricingTable.tableName,
                    OFFERS_TABLE_NAME: props.offersTable.tableName,
                },
            }
        );

        props.table.grantReadData(this.validateCheckoutFunction);
        props.pricingTable.grantReadData(this.validateCheckoutFunction);
        props.offersTable.grantReadData(this.validateCheckoutFunction);

        this.upsertBookingOffersFunction = new lambdaNodejs.NodejsFunction(
            this,
            'UpsertBookingOffersHandler',
            {
                functionName: 'blockbuster-theatre-upsert-booking-offers-handler',
                runtime: lambdaSettings.runtime,
                entry: path.join(__dirname, './handlers/upsert-booking-offers-handler.ts'),
                handler: 'handler',
                memorySize: lambdaSettings.default.memorySize,
                timeout: cdk.Duration.seconds(lambdaSettings.default.timeoutSeconds),
                environment: {
                    OFFERS_TABLE_NAME: props.offersTable.tableName,
                },
            }
        );

        props.offersTable.grantReadWriteData(this.upsertBookingOffersFunction);

        this.upsertTicketPricingFunction = new lambdaNodejs.NodejsFunction(
            this,
            'UpsertTicketPricingHandler',
            {
                functionName: 'blockbuster-theatre-upsert-ticket-pricing-handler',
                runtime: lambdaSettings.runtime,
                entry: path.join(__dirname, './handlers/upsert-ticket-pricing-handler.ts'),
                handler: 'handler',
                memorySize: lambdaSettings.default.memorySize,
                timeout: cdk.Duration.seconds(lambdaSettings.default.timeoutSeconds),
                environment: {
                    PRICING_TABLE_NAME: props.pricingTable.tableName,
                },
            }
        );

        props.pricingTable.grantReadWriteData(this.upsertTicketPricingFunction);

        this.upsertMovieCollectionsFunction = new lambdaNodejs.NodejsFunction(
            this,
            'UpsertMovieCollectionsHandler',
            {
                functionName: 'blockbuster-theatre-upsert-movie-collections-handler',
                runtime: lambdaSettings.runtime,
                entry: path.join(__dirname, './handlers/upsert-movie-collections-handler.ts'),
                handler: 'handler',
                memorySize: lambdaSettings.collectionUpsert.memorySize,
                timeout: cdk.Duration.seconds(lambdaSettings.collectionUpsert.timeoutSeconds),
                environment: {
                    COLLECTIONS_TABLE_NAME: props.collectionsTable.tableName,
                },
            }
        );

        props.collectionsTable.grantReadWriteData(this.upsertMovieCollectionsFunction);
    }
}