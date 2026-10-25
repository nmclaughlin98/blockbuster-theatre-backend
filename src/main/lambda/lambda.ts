import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ses from 'aws-cdk-lib/aws-ses';
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
    bookingsTable: dynamodb.Table;
    legacyBookingsTable: dynamodb.Table;
    showtimeRegistryTable: dynamodb.Table;
    bookingReferencesTable: dynamodb.Table;
    guestConversionTokensTable: dynamodb.Table;
    userPool: cognito.IUserPool;
    userPoolClient: cognito.IUserPoolClient;
    bookingEmailIdentity: ses.IEmailIdentity;
    lambdaConfig?: MovieImportLambdaConfig;
}

export class LambdaConstruct extends Construct {
    public readonly addMoviesFunction: lambdaNodejs.NodejsFunction;
    public readonly updateMoviesFunction: lambdaNodejs.NodejsFunction;
    public readonly listMoviesFunction: lambdaNodejs.NodejsFunction;
    public readonly listFeaturedMoviesFunction: lambdaNodejs.NodejsFunction;
    public readonly getMovieFunction: lambdaNodejs.NodejsFunction;
    public readonly exportMoviesFunction: lambdaNodejs.NodejsFunction;
    public readonly listTmdbIdsFunction: lambdaNodejs.NodejsFunction;
    public readonly listFilmSelectionsFunction: lambdaNodejs.NodejsFunction;
    public readonly getTicketPricingFunction: lambdaNodejs.NodejsFunction;
    public readonly validateCheckoutFunction: lambdaNodejs.NodejsFunction;
    public readonly sendBookingConfirmationFunction: lambdaNodejs.NodejsFunction;
    public readonly upsertBookingOffersFunction: lambdaNodejs.NodejsFunction;
    public readonly upsertTicketPricingFunction: lambdaNodejs.NodejsFunction;
    public readonly listMovieCollectionsFunction: lambdaNodejs.NodejsFunction;
    public readonly getMovieCollectionFunction: lambdaNodejs.NodejsFunction;
    public readonly refreshMovieCollectionFunction: lambdaNodejs.NodejsFunction;
    public readonly listBookingsFunction: lambdaNodejs.NodejsFunction;
    public readonly createBookingFunction: lambdaNodejs.NodejsFunction;
    public readonly guestBookedSeatsFunction: lambdaNodejs.NodejsFunction;
    public readonly guestBookingFunction: lambdaNodejs.NodejsFunction;
    public readonly guestConversionFunction: lambdaNodejs.NodejsFunction;

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
                TMDB_API_KEY: process.env.TMDB_API_KEY ?? '',
                MAX_BATCH: String(lambdaConfig.maxBatch),
                TMDB_CONCURRENCY: String(lambdaConfig.tmdbConcurrency),
                TMDB_TIMEOUT_MS: String(lambdaConfig.tmdbTimeoutMs),
                TMDB_RETRIES: String(lambdaConfig.tmdbRetries),
            },
        });

        props.table.grantReadWriteData(this.addMoviesFunction);

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
                SHOWTIME_REGISTRY_TABLE_NAME: props.showtimeRegistryTable.tableName,
            },
        });

        props.table.grantReadData(this.listMoviesFunction);
        props.showtimeRegistryTable.grantReadWriteData(this.listMoviesFunction);

        this.listFeaturedMoviesFunction = new lambdaNodejs.NodejsFunction(
            this,
            'ListFeaturedMoviesHandler',
            {
                functionName: 'blockbuster-theatre-list-featured-movies-handler',
                runtime: lambdaSettings.runtime,
                entry: path.join(__dirname, './handlers/list-featured-movies-handler.ts'),
                handler: 'handler',
                memorySize: lambdaSettings.default.memorySize,
                timeout: cdk.Duration.seconds(lambdaSettings.default.timeoutSeconds),
                environment: {
                    TABLE_NAME: props.table.tableName,
                    SHOWTIME_REGISTRY_TABLE_NAME: props.showtimeRegistryTable.tableName,
                },
            }
        );

        props.table.grantReadData(this.listFeaturedMoviesFunction);
        props.showtimeRegistryTable.grantReadWriteData(this.listFeaturedMoviesFunction);

        this.getMovieFunction = new lambdaNodejs.NodejsFunction(this, 'GetMovieHandler', {
            functionName: 'blockbuster-theatre-get-movie-lambda',
            runtime: lambdaSettings.runtime,
            entry: path.join(__dirname, './handlers/get-movie-handler.ts'),
            handler: 'handler',
            memorySize: lambdaSettings.default.memorySize,
            timeout: cdk.Duration.seconds(lambdaSettings.default.timeoutSeconds),
            environment: {
                TABLE_NAME: props.table.tableName,
                SHOWTIME_REGISTRY_TABLE_NAME: props.showtimeRegistryTable.tableName,
            },
        });

        props.table.grantReadData(this.getMovieFunction);
        props.showtimeRegistryTable.grantReadWriteData(this.getMovieFunction);

        this.listMovieCollectionsFunction = new lambdaNodejs.NodejsFunction(
            this,
            'ListMovieCollectionsHandler',
            {
                functionName: 'blockbuster-theatre-list-movie-collections-handler',
                runtime: lambdaSettings.runtime,
                entry: path.join(__dirname, './handlers/list-movie-collections-handler.ts'),
                handler: 'handler',
                memorySize: lambdaSettings.default.memorySize,
                timeout: cdk.Duration.seconds(lambdaSettings.default.timeoutSeconds),
                environment: {
                    COLLECTIONS_TABLE_NAME: props.collectionsTable.tableName,
                },
            }
        );

        props.collectionsTable.grantReadData(this.listMovieCollectionsFunction);

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
                    SHOWTIME_REGISTRY_TABLE_NAME: props.showtimeRegistryTable.tableName,
                },
            }
        );

        props.table.grantReadData(this.getMovieCollectionFunction);
        props.collectionsTable.grantReadData(this.getMovieCollectionFunction);
        props.showtimeRegistryTable.grantReadWriteData(this.getMovieCollectionFunction);

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
                    SHOWTIME_REGISTRY_TABLE_NAME: props.showtimeRegistryTable.tableName,
                },
            }
        );

        props.table.grantReadData(this.listFilmSelectionsFunction);
        props.offersTable.grantReadData(this.listFilmSelectionsFunction);
        props.showtimeRegistryTable.grantReadWriteData(this.listFilmSelectionsFunction);

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

        this.sendBookingConfirmationFunction = new lambdaNodejs.NodejsFunction(
            this,
            'SendBookingConfirmationHandler',
            {
                functionName: 'blockbuster-theatre-booking-confirmation-handler',
                runtime: lambdaSettings.runtime,
                entry: path.join(__dirname, './handlers/send-booking-confirmation-handler.ts'),
                handler: 'handler',
                memorySize: lambdaSettings.default.memorySize,
                timeout: cdk.Duration.seconds(lambdaSettings.default.timeoutSeconds),
                environment: {
                    BOOKING_EMAIL_FROM: props.bookingEmailIdentity.emailIdentityName,
                },
            }
        );

        props.bookingEmailIdentity.grantSendEmail(this.sendBookingConfirmationFunction);

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

        this.refreshMovieCollectionFunction = new lambdaNodejs.NodejsFunction(
            this,
            'RefreshMovieCollectionHandler',
            {
                functionName: 'blockbuster-theatre-refresh-movie-collection-handler',
                runtime: lambdaSettings.runtime,
                entry: path.join(__dirname, './handlers/refresh-movie-collection-handler.ts'),
                handler: 'handler',
                memorySize: lambdaSettings.collectionRefresh.memorySize,
                timeout: cdk.Duration.seconds(lambdaSettings.collectionRefresh.timeoutSeconds),
                environment: {
                    COLLECTIONS_TABLE_NAME: props.collectionsTable.tableName,
                    TMDB_API_KEY: process.env.TMDB_API_KEY ?? '',
                    TMDB_TIMEOUT_MS: String(lambdaConfig.tmdbTimeoutMs),
                    TMDB_RETRIES: String(lambdaConfig.tmdbRetries),
                },
            }
        );

        props.collectionsTable.grantReadWriteData(this.refreshMovieCollectionFunction);

        this.listBookingsFunction = new lambdaNodejs.NodejsFunction(this, 'ListBookingsHandler', {
            functionName: 'blockbuster-theatre-list-bookings-handler',
            runtime: lambdaSettings.runtime,
            entry: path.join(__dirname, './handlers/list-bookings-handler.ts'),
            handler: 'handler',
            memorySize: lambdaSettings.default.memorySize,
            timeout: cdk.Duration.seconds(lambdaSettings.default.timeoutSeconds),
            environment: {
                BOOKINGS_TABLE_NAME: props.bookingsTable.tableName,
                LEGACY_BOOKINGS_TABLE_NAME: props.legacyBookingsTable.tableName,
                SHOWTIME_REGISTRY_TABLE_NAME: props.showtimeRegistryTable.tableName,
                TABLE_NAME: props.table.tableName,
                PRICING_TABLE_NAME: props.pricingTable.tableName,
                OFFERS_TABLE_NAME: props.offersTable.tableName,
            },
        });

        props.bookingsTable.grantReadData(this.listBookingsFunction);
        props.legacyBookingsTable.grantReadData(this.listBookingsFunction);
        props.showtimeRegistryTable.grantReadData(this.listBookingsFunction);
        props.table.grantReadData(this.listBookingsFunction);
        props.pricingTable.grantReadData(this.listBookingsFunction);
        props.offersTable.grantReadData(this.listBookingsFunction);

        // Booking creation validates the movie and showtime, which needs the pricing lookups.
        this.createBookingFunction = new lambdaNodejs.NodejsFunction(this, 'CreateBookingHandler', {
            functionName: 'blockbuster-theatre-create-booking-handler',
            runtime: lambdaSettings.runtime,
            entry: path.join(__dirname, './handlers/create-booking-handler.ts'),
            handler: 'handler',
            memorySize: lambdaSettings.default.memorySize,
            timeout: cdk.Duration.seconds(lambdaSettings.default.timeoutSeconds),
            environment: {
                TABLE_NAME: props.table.tableName,
                PRICING_TABLE_NAME: props.pricingTable.tableName,
                OFFERS_TABLE_NAME: props.offersTable.tableName,
                BOOKINGS_TABLE_NAME: props.bookingsTable.tableName,
                LEGACY_BOOKINGS_TABLE_NAME: props.legacyBookingsTable.tableName,
                SHOWTIME_REGISTRY_TABLE_NAME: props.showtimeRegistryTable.tableName,
            },
        });

        props.table.grantReadData(this.createBookingFunction);
        props.pricingTable.grantReadData(this.createBookingFunction);
        props.offersTable.grantReadData(this.createBookingFunction);
        props.bookingsTable.grantWriteData(this.createBookingFunction);
        props.legacyBookingsTable.grantReadData(this.createBookingFunction);
        props.showtimeRegistryTable.grantReadWriteData(this.createBookingFunction);

        this.guestBookedSeatsFunction = new lambdaNodejs.NodejsFunction(
            this,
            'GuestBookedSeatsHandler',
            {
                functionName: 'blockbuster-theatre-guest-booked-seats-handler',
                runtime: lambdaSettings.runtime,
                entry: path.join(__dirname, './handlers/guest-booked-seats-handler.ts'),
                handler: 'handler',
                memorySize: lambdaSettings.default.memorySize,
                timeout: cdk.Duration.seconds(lambdaSettings.default.timeoutSeconds),
                environment: {
                    BOOKINGS_TABLE_NAME: props.bookingsTable.tableName,
                    LEGACY_BOOKINGS_TABLE_NAME: props.legacyBookingsTable.tableName,
                    SHOWTIME_REGISTRY_TABLE_NAME: props.showtimeRegistryTable.tableName,
                },
            }
        );
        props.bookingsTable.grantReadData(this.guestBookedSeatsFunction);
        props.legacyBookingsTable.grantReadData(this.guestBookedSeatsFunction);
        props.showtimeRegistryTable.grantReadData(this.guestBookedSeatsFunction);

        this.guestBookingFunction = new lambdaNodejs.NodejsFunction(
            this,
            'GuestBookingHandler',
            {
                functionName: 'blockbuster-theatre-guest-booking-handler',
                runtime: lambdaSettings.runtime,
                entry: path.join(__dirname, './handlers/guest-booking-handler.ts'),
                handler: 'handler',
                memorySize: lambdaSettings.default.memorySize,
                timeout: cdk.Duration.seconds(lambdaSettings.default.timeoutSeconds),
                environment: {
                    TABLE_NAME: props.table.tableName,
                    PRICING_TABLE_NAME: props.pricingTable.tableName,
                    OFFERS_TABLE_NAME: props.offersTable.tableName,
                    BOOKINGS_TABLE_NAME: props.bookingsTable.tableName,
                    LEGACY_BOOKINGS_TABLE_NAME: props.legacyBookingsTable.tableName,
                    SHOWTIME_REGISTRY_TABLE_NAME: props.showtimeRegistryTable.tableName,
                    BOOKING_REFERENCES_TABLE_NAME: props.bookingReferencesTable.tableName,
                    GUEST_CONVERSION_TOKENS_TABLE_NAME:
                        props.guestConversionTokensTable.tableName,
                    BOOKING_EMAIL_FROM: props.bookingEmailIdentity.emailIdentityName,
                },
            }
        );
        props.table.grantReadData(this.guestBookingFunction);
        props.pricingTable.grantReadData(this.guestBookingFunction);
        props.offersTable.grantReadData(this.guestBookingFunction);
        props.bookingsTable.grantWriteData(this.guestBookingFunction);
        props.legacyBookingsTable.grantReadData(this.guestBookingFunction);
        props.showtimeRegistryTable.grantReadData(this.guestBookingFunction);
        props.bookingReferencesTable.grantWriteData(this.guestBookingFunction);
        props.guestConversionTokensTable.grantWriteData(this.guestBookingFunction);
        props.bookingEmailIdentity.grantSendEmail(this.guestBookingFunction);

        this.guestConversionFunction = new lambdaNodejs.NodejsFunction(
            this,
            'GuestConversionHandler',
            {
                functionName: 'blockbuster-theatre-guest-conversion-handler',
                runtime: lambdaSettings.runtime,
                entry: path.join(__dirname, './handlers/guest-conversion-handler.ts'),
                handler: 'handler',
                memorySize: lambdaSettings.default.memorySize,
                timeout: cdk.Duration.seconds(lambdaSettings.default.timeoutSeconds),
                environment: {
                    BOOKINGS_TABLE_NAME: props.bookingsTable.tableName,
                    LEGACY_BOOKINGS_TABLE_NAME: props.legacyBookingsTable.tableName,
                    SHOWTIME_REGISTRY_TABLE_NAME: props.showtimeRegistryTable.tableName,
                    GUEST_CONVERSION_TOKENS_TABLE_NAME:
                        props.guestConversionTokensTable.tableName,
                    USER_POOL_ID: props.userPool.userPoolId,
                    USER_POOL_CLIENT_ID: props.userPoolClient.userPoolClientId,
                },
            }
        );
        props.bookingsTable.grantReadWriteData(this.guestConversionFunction);
        props.legacyBookingsTable.grantReadWriteData(this.guestConversionFunction);
        props.showtimeRegistryTable.grantReadData(this.guestConversionFunction);
        props.guestConversionTokensTable.grantReadWriteData(this.guestConversionFunction);
        this.guestConversionFunction.addToRolePolicy(
            new iam.PolicyStatement({
                actions: [
                    'cognito-idp:AdminCreateUser',
                    'cognito-idp:AdminGetUser',
                    'cognito-idp:AdminInitiateAuth',
                    'cognito-idp:AdminSetUserPassword',
                ],
                resources: [props.userPool.userPoolArn],
            })
        );
    }
}