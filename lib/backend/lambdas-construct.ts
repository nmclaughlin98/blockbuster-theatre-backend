import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { Construct } from 'constructs';
import * as path from 'path';
import { maxTicketsParameterForEnvironment, resourceName, type EnvironmentName } from '../shared';

export const lambdaSettings = {
    architecture: lambda.Architecture.ARM_64,
    runtime: lambda.Runtime.NODEJS_24_X,
    default: { memorySize: 256, timeoutSeconds: 10 },
    batchProcessing: { memorySize: 256, timeoutSeconds: 15 },
    collectionTreeRead: { memorySize: 256, timeoutSeconds: 25 },
    collectionRefresh: { memorySize: 512, timeoutSeconds: 25 },
    fullTableExport: { memorySize: 512, timeoutSeconds: 25 },
    fullTableRead: { memorySize: 256, timeoutSeconds: 25 },
    paginatedSelectionRead: { memorySize: 256, timeoutSeconds: 15 },
} as const;

export interface MovieImportLambdaConfig {
    memorySize: number;
    timeoutSeconds: number;
    reservedConcurrentExecutions?: number;
    maxBatch: number;
    tmdbConcurrency: number;
    tmdbTimeoutMs: number;
    tmdbRetries: number;
}

export const movieImportLambdaConfig: MovieImportLambdaConfig = {
    memorySize: 512,
    timeoutSeconds: 25,
    maxBatch: 100,
    tmdbConcurrency: 5,
    tmdbTimeoutMs: 4000,
    tmdbRetries: 3,
};

export const movieUpdateMaxBatch = 25;
export const maxTicketsParameterName = '/blockbuster-theatre/booking-configuration/max-tickets-value';

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
    envName?: EnvironmentName;
}

function createNodejsFunction(
    scope: Construct,
    id: string,
    props: lambdaNodejs.NodejsFunctionProps,
): lambdaNodejs.NodejsFunction {
    if (!props.functionName) {
        throw new Error(`Function ${id} must have a name to configure its log group.`);
    }

    return new lambdaNodejs.NodejsFunction(scope, id, {
        ...props,
        logRetention: logs.RetentionDays.ONE_WEEK,
    });
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
    public readonly rescheduleBookingFunction: lambdaNodejs.NodejsFunction;
    public readonly manageShowtimesFunction: lambdaNodejs.NodejsFunction;
    public readonly maintainScheduleFunction: lambdaNodejs.NodejsFunction;
    public readonly guestBookedSeatsFunction: lambdaNodejs.NodejsFunction;
    public readonly guestBookingFunction: lambdaNodejs.NodejsFunction;
    public readonly guestConversionFunction: lambdaNodejs.NodejsFunction;
    public readonly downloadTicketFunction: lambdaNodejs.NodejsFunction;

    /**
     * Creates the movie import, update, list, and detail Lambda functions with table permissions.
     * @param scope Parent CDK construct.
     * @param id Construct identifier.
     * @param props DynamoDB table and optional import Lambda configuration.
     */
    constructor(scope: Construct, id: string, props: LambdaConstructProps) {
        super(scope, id);
        const lambdaConfig = props.lambdaConfig ?? movieImportLambdaConfig;
        const envName = props.envName ?? 'prod';

        if (!process.env.TMDB_API_KEY?.trim()) {
            throw new Error('TMDB_API_KEY must be set and non-empty before synthesizing the stack.');
        }

        const tmdbApiKey = new cdk.CfnParameter(cdk.Stack.of(this), 'TmdbApiKey', {
            type: 'String',
            noEcho: true,
            minLength: 1,
            description: 'TMDB API read access token',
        }).valueAsString;

        const formatLambdaFunctionName = (name: string): string => resourceName(name, envName);
        const scopedMaxTicketsParameterName = maxTicketsParameterForEnvironment(
            maxTicketsParameterName,
            envName,
        );

        // PDFKit resolves its fonts and other assets relative to its installed package.
        const pdfKitBundling = { nodeModules: ['pdfkit'] };
        const maxTicketsParameter = ssm.StringParameter.fromStringParameterName(
            this,
            'MaxTicketsParameter',
            scopedMaxTicketsParameterName,
        );

        const allowLinkBookingsParameterName = resourceName(
            '/blockbuster-theatre/parameter-configurations/ALLOW_LINK_BOOKINGS',
            envName,
        );

        const allowLinkBookingsParameter = ssm.StringParameter.fromStringParameterName(
            this,
            'AllowLinkBookingsParameter',
            allowLinkBookingsParameterName,
        );

        this.addMoviesFunction = createNodejsFunction(this, 'AddMoviesHandler', {
            functionName: formatLambdaFunctionName('blockbuster-theatre-add-movies-handler'),
            runtime: lambdaSettings.runtime,
            entry: path.join(__dirname, '../../src/main/lambda/handlers/AddMovies/add-movies-handler.ts'),
            handler: 'handler',
            memorySize: lambdaConfig.memorySize,
            timeout: cdk.Duration.seconds(lambdaConfig.timeoutSeconds),
            ...(lambdaConfig.reservedConcurrentExecutions !== undefined && {
                reservedConcurrentExecutions: lambdaConfig.reservedConcurrentExecutions,
            }),
            environment: {
                TABLE_NAME: props.table.tableName,
                TMDB_API_KEY: tmdbApiKey,
                MAX_BATCH: String(lambdaConfig.maxBatch),
                TMDB_CONCURRENCY: String(lambdaConfig.tmdbConcurrency),
                TMDB_TIMEOUT_MS: String(lambdaConfig.tmdbTimeoutMs),
                TMDB_RETRIES: String(lambdaConfig.tmdbRetries),
            },
        });

        props.table.grantReadWriteData(this.addMoviesFunction);

        this.updateMoviesFunction = createNodejsFunction(this, 'UpdateMoviesHandler', {
            functionName: formatLambdaFunctionName('blockbuster-theatre-update-movies-handler'),
            runtime: lambdaSettings.runtime,
            entry: path.join(
                __dirname,
                '../../src/main/lambda/handlers/UpdateMovies/update-movies-handler.ts',
            ),
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

        this.listMoviesFunction = createNodejsFunction(this, 'ListMoviesHandler', {
            functionName: formatLambdaFunctionName('blockbuster-theatre-list-movies-handler'),
            runtime: lambdaSettings.runtime,
            entry: path.join(__dirname, '../../src/main/lambda/handlers/ListMovies/list-movies-handler.ts'),
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

        this.listFeaturedMoviesFunction = createNodejsFunction(this, 'ListFeaturedMoviesHandler', {
            functionName: formatLambdaFunctionName('blockbuster-theatre-list-featured-movies-handler'),
            runtime: lambdaSettings.runtime,
            entry: path.join(
                __dirname,
                '../../src/main/lambda/handlers/ListFeaturedMovies/list-featured-movies-handler.ts',
            ),
            handler: 'handler',
            memorySize: lambdaSettings.default.memorySize,
            timeout: cdk.Duration.seconds(lambdaSettings.default.timeoutSeconds),
            environment: {
                TABLE_NAME: props.table.tableName,
                SHOWTIME_REGISTRY_TABLE_NAME: props.showtimeRegistryTable.tableName,
            },
        });

        props.table.grantReadData(this.listFeaturedMoviesFunction);
        props.showtimeRegistryTable.grantReadWriteData(this.listFeaturedMoviesFunction);

        this.getMovieFunction = createNodejsFunction(this, 'GetMovieHandler', {
            functionName: formatLambdaFunctionName('blockbuster-theatre-get-movie-lambda'),
            runtime: lambdaSettings.runtime,
            entry: path.join(__dirname, '../../src/main/lambda/handlers/GetMovie/get-movie-handler.ts'),
            handler: 'handler',
            memorySize: lambdaSettings.default.memorySize,
            timeout: cdk.Duration.seconds(lambdaSettings.default.timeoutSeconds),
            environment: {
                TABLE_NAME: props.table.tableName,
                SHOWTIME_REGISTRY_TABLE_NAME: props.showtimeRegistryTable.tableName,
            },
        });

        props.table.grantReadData(this.getMovieFunction);
        props.showtimeRegistryTable.grantReadData(this.getMovieFunction);

        this.listMovieCollectionsFunction = createNodejsFunction(this, 'ListMovieCollectionsHandler', {
            functionName: formatLambdaFunctionName('blockbuster-theatre-list-movie-collections-handler'),
            runtime: lambdaSettings.runtime,
            entry: path.join(
                __dirname,
                '../../src/main/lambda/handlers/ListMovieCollections/list-movie-collections-handler.ts',
            ),
            handler: 'handler',
            memorySize: lambdaSettings.default.memorySize,
            timeout: cdk.Duration.seconds(lambdaSettings.default.timeoutSeconds),
            environment: {
                COLLECTIONS_TABLE_NAME: props.collectionsTable.tableName,
            },
        });

        props.collectionsTable.grantReadData(this.listMovieCollectionsFunction);

        this.getMovieCollectionFunction = createNodejsFunction(this, 'GetMovieCollectionHandler', {
            functionName: formatLambdaFunctionName('blockbuster-theatre-get-movie-collection-handler'),
            runtime: lambdaSettings.runtime,
            entry: path.join(
                __dirname,
                '../../src/main/lambda/handlers/GetMovieCollection/get-movie-collection-handler.ts',
            ),
            handler: 'handler',
            memorySize: lambdaSettings.collectionTreeRead.memorySize,
            timeout: cdk.Duration.seconds(lambdaSettings.collectionTreeRead.timeoutSeconds),
            environment: {
                TABLE_NAME: props.table.tableName,
                COLLECTIONS_TABLE_NAME: props.collectionsTable.tableName,
                SHOWTIME_REGISTRY_TABLE_NAME: props.showtimeRegistryTable.tableName,
            },
        });

        props.table.grantReadData(this.getMovieCollectionFunction);
        props.collectionsTable.grantReadData(this.getMovieCollectionFunction);
        props.showtimeRegistryTable.grantReadWriteData(this.getMovieCollectionFunction);

        this.exportMoviesFunction = createNodejsFunction(this, 'ExportMoviesHandler', {
            functionName: formatLambdaFunctionName('blockbuster-theatre-export-movies-handler'),
            runtime: lambdaSettings.runtime,
            entry: path.join(
                __dirname,
                '../../src/main/lambda/handlers/ExportMovies/export-movies-handler.ts',
            ),
            handler: 'handler',
            memorySize: lambdaSettings.fullTableExport.memorySize,
            timeout: cdk.Duration.seconds(lambdaSettings.fullTableExport.timeoutSeconds),
            environment: {
                TABLE_NAME: props.table.tableName,
            },
        });

        props.table.grantReadData(this.exportMoviesFunction);

        this.listTmdbIdsFunction = createNodejsFunction(this, 'ListTmdbIdsHandler', {
            functionName: formatLambdaFunctionName('blockbuster-theatre-list-tmdb-ids-lambda'),
            runtime: lambdaSettings.runtime,
            entry: path.join(
                __dirname,
                '../../src/main/lambda/handlers/ListTmdbIds/list-tmdb-ids-handler.ts',
            ),
            handler: 'handler',
            memorySize: lambdaSettings.fullTableRead.memorySize,
            timeout: cdk.Duration.seconds(lambdaSettings.fullTableRead.timeoutSeconds),
            environment: {
                TABLE_NAME: props.table.tableName,
            },
        });

        props.table.grantReadData(this.listTmdbIdsFunction);

        this.listFilmSelectionsFunction = createNodejsFunction(this, 'ListFilmSelectionsHandler', {
            functionName: formatLambdaFunctionName('blockbuster-theatre-film-selections-handler'),
            runtime: lambdaSettings.runtime,
            entry: path.join(
                __dirname,
                '../../src/main/lambda/handlers/ListFilmSelections/list-film-selections-handler.ts',
            ),
            handler: 'handler',
            memorySize: lambdaSettings.paginatedSelectionRead.memorySize,
            timeout: cdk.Duration.seconds(lambdaSettings.paginatedSelectionRead.timeoutSeconds),
            environment: {
                TABLE_NAME: props.table.tableName,
                OFFERS_TABLE_NAME: props.offersTable.tableName,
                SHOWTIME_REGISTRY_TABLE_NAME: props.showtimeRegistryTable.tableName,
            },
        });

        props.table.grantReadData(this.listFilmSelectionsFunction);
        props.offersTable.grantReadData(this.listFilmSelectionsFunction);
        props.showtimeRegistryTable.grantReadWriteData(this.listFilmSelectionsFunction);

        this.getTicketPricingFunction = createNodejsFunction(this, 'GetTicketPricingHandler', {
            functionName: formatLambdaFunctionName('blockbuster-theatre-ticket-pricing-handler'),
            runtime: lambdaSettings.runtime,
            entry: path.join(
                __dirname,
                '../../src/main/lambda/handlers/GetTicketPricing/get-ticket-pricing-handler.ts',
            ),
            handler: 'handler',
            memorySize: lambdaSettings.default.memorySize,
            timeout: cdk.Duration.seconds(lambdaSettings.default.timeoutSeconds),
            environment: {
                TABLE_NAME: props.table.tableName,
                PRICING_TABLE_NAME: props.pricingTable.tableName,
                OFFERS_TABLE_NAME: props.offersTable.tableName,
                SHOWTIME_REGISTRY_TABLE_NAME: props.showtimeRegistryTable.tableName,
            },
        });

        props.table.grantReadData(this.getTicketPricingFunction);
        props.pricingTable.grantReadData(this.getTicketPricingFunction);
        props.offersTable.grantReadData(this.getTicketPricingFunction);
        props.showtimeRegistryTable.grantReadWriteData(this.getTicketPricingFunction);

        this.validateCheckoutFunction = createNodejsFunction(this, 'ValidateCheckoutHandler', {
            functionName: formatLambdaFunctionName('blockbuster-theatre-checkout-validation-handler'),
            runtime: lambdaSettings.runtime,
            entry: path.join(
                __dirname,
                '../../src/main/lambda/handlers/ValidateCheckout/validate-checkout-handler.ts',
            ),
            handler: 'handler',
            memorySize: lambdaSettings.default.memorySize,
            timeout: cdk.Duration.seconds(lambdaSettings.default.timeoutSeconds),
            environment: {
                TABLE_NAME: props.table.tableName,
                PRICING_TABLE_NAME: props.pricingTable.tableName,
                OFFERS_TABLE_NAME: props.offersTable.tableName,
                SHOWTIME_REGISTRY_TABLE_NAME: props.showtimeRegistryTable.tableName,
            },
        });

        props.table.grantReadData(this.validateCheckoutFunction);
        props.pricingTable.grantReadData(this.validateCheckoutFunction);
        props.offersTable.grantReadData(this.validateCheckoutFunction);
        props.showtimeRegistryTable.grantReadWriteData(this.validateCheckoutFunction);

        this.sendBookingConfirmationFunction = createNodejsFunction(this, 'SendBookingConfirmationHandler', {
            functionName: formatLambdaFunctionName('blockbuster-theatre-booking-confirmation-handler'),
            runtime: lambdaSettings.runtime,
            entry: path.join(
                __dirname,
                '../../src/main/lambda/handlers/SendBookingConfirmation/send-booking-confirmation-handler.ts',
            ),
            handler: 'handler',
            bundling: pdfKitBundling,
            memorySize: lambdaSettings.default.memorySize,
            timeout: cdk.Duration.seconds(lambdaSettings.default.timeoutSeconds),
            environment: {
                BOOKING_EMAIL_FROM: props.bookingEmailIdentity.emailIdentityName,
                MAX_TICKETS_PARAMETER_NAME: scopedMaxTicketsParameterName,
            },
        });

        props.bookingEmailIdentity.grantSendEmail(this.sendBookingConfirmationFunction);
        maxTicketsParameter.grantRead(this.sendBookingConfirmationFunction);

        this.upsertBookingOffersFunction = createNodejsFunction(this, 'UpsertBookingOffersHandler', {
            functionName: formatLambdaFunctionName('blockbuster-theatre-upsert-booking-offers-handler'),
            runtime: lambdaSettings.runtime,
            entry: path.join(
                __dirname,
                '../../src/main/lambda/handlers/UpsertBookingOffers/upsert-booking-offers-handler.ts',
            ),
            handler: 'handler',
            memorySize: lambdaSettings.default.memorySize,
            timeout: cdk.Duration.seconds(lambdaSettings.default.timeoutSeconds),
            environment: {
                OFFERS_TABLE_NAME: props.offersTable.tableName,
            },
        });

        props.offersTable.grantReadWriteData(this.upsertBookingOffersFunction);

        this.upsertTicketPricingFunction = createNodejsFunction(this, 'UpsertTicketPricingHandler', {
            functionName: formatLambdaFunctionName('blockbuster-theatre-upsert-ticket-pricing-handler'),
            runtime: lambdaSettings.runtime,
            entry: path.join(
                __dirname,
                '../../src/main/lambda/handlers/UpsertTicketPricing/upsert-ticket-pricing-handler.ts',
            ),
            handler: 'handler',
            memorySize: lambdaSettings.default.memorySize,
            timeout: cdk.Duration.seconds(lambdaSettings.default.timeoutSeconds),
            environment: {
                PRICING_TABLE_NAME: props.pricingTable.tableName,
            },
        });

        props.pricingTable.grantReadWriteData(this.upsertTicketPricingFunction);

        this.refreshMovieCollectionFunction = createNodejsFunction(this, 'RefreshMovieCollectionHandler', {
            functionName: formatLambdaFunctionName('blockbuster-theatre-refresh-movie-collection-handler'),
            runtime: lambdaSettings.runtime,
            entry: path.join(
                __dirname,
                '../../src/main/lambda/handlers/RefreshMovieCollection/refresh-movie-collection-handler.ts',
            ),
            handler: 'handler',
            memorySize: lambdaSettings.collectionRefresh.memorySize,
            timeout: cdk.Duration.seconds(lambdaSettings.collectionRefresh.timeoutSeconds),
            environment: {
                COLLECTIONS_TABLE_NAME: props.collectionsTable.tableName,
                TMDB_API_KEY: tmdbApiKey,
                TMDB_TIMEOUT_MS: String(lambdaConfig.tmdbTimeoutMs),
                TMDB_RETRIES: String(lambdaConfig.tmdbRetries),
            },
        });

        props.collectionsTable.grantReadWriteData(this.refreshMovieCollectionFunction);

        this.listBookingsFunction = createNodejsFunction(this, 'ListBookingsHandler', {
            functionName: formatLambdaFunctionName('blockbuster-theatre-list-bookings-handler'),
            runtime: lambdaSettings.runtime,
            entry: path.join(
                __dirname,
                '../../src/main/lambda/handlers/ListBookings/list-bookings-handler.ts',
            ),
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
        this.createBookingFunction = createNodejsFunction(this, 'CreateBookingHandler', {
            functionName: formatLambdaFunctionName('blockbuster-theatre-create-booking-handler'),
            runtime: lambdaSettings.runtime,
            entry: path.join(
                __dirname,
                '../../src/main/lambda/handlers/CreateBooking/create-booking-handler.ts',
            ),
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

        this.rescheduleBookingFunction = createNodejsFunction(this, 'RescheduleCustomerBookingHandler', {
            functionName: formatLambdaFunctionName('blockbuster-theatre-reschedule-customer-booking-handler'),
            runtime: lambdaSettings.runtime,
            entry: path.join(
                __dirname,
                '../../src/main/lambda/handlers/RescheduleCustomerBooking/reschedule-customer-booking-handler.ts',
            ),
            handler: 'handler',
            memorySize: lambdaSettings.default.memorySize,
            timeout: cdk.Duration.seconds(lambdaSettings.default.timeoutSeconds),
            environment: {
                BOOKINGS_TABLE_NAME: props.bookingsTable.tableName,
                SHOWTIME_REGISTRY_TABLE_NAME: props.showtimeRegistryTable.tableName,
            },
        });

        props.bookingsTable.grant(
            this.rescheduleBookingFunction,
            'dynamodb:Query',
            'dynamodb:DeleteItem',
            'dynamodb:PutItem',
        );

        props.showtimeRegistryTable.grantReadData(this.rescheduleBookingFunction);
        props.showtimeRegistryTable.grant(this.rescheduleBookingFunction, 'dynamodb:ConditionCheckItem');

        this.manageShowtimesFunction = createNodejsFunction(this, 'ManageShowtimesHandler', {
            functionName: formatLambdaFunctionName('blockbuster-theatre-manage-showtimes-handler'),
            runtime: lambdaSettings.runtime,
            entry: path.join(
                __dirname,
                '../../src/main/lambda/handlers/ManageShowtimes/manage-showtimes-handler.ts',
            ),
            handler: 'handler',
            memorySize: lambdaSettings.default.memorySize,
            timeout: cdk.Duration.seconds(lambdaSettings.default.timeoutSeconds),
            environment: {
                TABLE_NAME: props.table.tableName,
                SHOWTIME_REGISTRY_TABLE_NAME: props.showtimeRegistryTable.tableName,
                BOOKINGS_TABLE_NAME: props.bookingsTable.tableName,
                LEGACY_BOOKINGS_TABLE_NAME: props.legacyBookingsTable.tableName,
            },
        });

        props.table.grantReadData(this.manageShowtimesFunction);
        props.showtimeRegistryTable.grantReadWriteData(this.manageShowtimesFunction);
        props.bookingsTable.grantReadData(this.manageShowtimesFunction);
        props.legacyBookingsTable.grantReadData(this.manageShowtimesFunction);

        this.maintainScheduleFunction = createNodejsFunction(this, 'MaintainScheduleHandler', {
            functionName: formatLambdaFunctionName('blockbuster-theatre-maintain-rolling-schedule-handler'),
            runtime: lambdaSettings.runtime,
            entry: path.join(
                __dirname,
                '../../src/main/lambda/handlers/MaintainSchedule/maintain-schedule-handler.ts',
            ),
            handler: 'handler',
            memorySize: 512,
            timeout: cdk.Duration.minutes(15),
            environment: {
                TABLE_NAME: props.table.tableName,
                SHOWTIME_REGISTRY_TABLE_NAME: props.showtimeRegistryTable.tableName,
                BOOKINGS_TABLE_NAME: props.bookingsTable.tableName,
                LEGACY_BOOKINGS_TABLE_NAME: props.legacyBookingsTable.tableName,
            },
        });

        props.table.grantReadData(this.maintainScheduleFunction);
        props.showtimeRegistryTable.grantReadWriteData(this.maintainScheduleFunction);
        props.bookingsTable.grantReadData(this.maintainScheduleFunction);
        props.legacyBookingsTable.grantReadData(this.maintainScheduleFunction);

        new events.Rule(this, 'MaintainRollingScheduleRule', {
            schedule: events.Schedule.rate(cdk.Duration.hours(6)),
            targets: [new targets.LambdaFunction(this.maintainScheduleFunction)],
        });

        this.guestBookedSeatsFunction = createNodejsFunction(this, 'GuestBookedSeatsHandler', {
            functionName: formatLambdaFunctionName('blockbuster-theatre-guest-booked-seats-handler'),
            runtime: lambdaSettings.runtime,
            entry: path.join(
                __dirname,
                '../../src/main/lambda/handlers/GuestBookedSeats/guest-booked-seats-handler.ts',
            ),
            handler: 'handler',
            bundling: pdfKitBundling,
            memorySize: lambdaSettings.default.memorySize,
            timeout: cdk.Duration.seconds(25),
            environment: {
                BOOKINGS_TABLE_NAME: props.bookingsTable.tableName,
                LEGACY_BOOKINGS_TABLE_NAME: props.legacyBookingsTable.tableName,
                SHOWTIME_REGISTRY_TABLE_NAME: props.showtimeRegistryTable.tableName,
                BOOKING_EMAIL_FROM: props.bookingEmailIdentity.emailIdentityName,
                ALLOW_LINK_BOOKINGS_PARAMETER_NAME: allowLinkBookingsParameterName,
                USER_POOL_ID: props.userPool.userPoolId,
            },
        });

        props.bookingsTable.grantReadWriteData(this.guestBookedSeatsFunction);
        props.legacyBookingsTable.grantReadWriteData(this.guestBookedSeatsFunction);
        props.showtimeRegistryTable.grantReadData(this.guestBookedSeatsFunction);
        props.bookingEmailIdentity.grantSendEmail(this.guestBookedSeatsFunction);
        this.guestBookedSeatsFunction.addToRolePolicy(
            new iam.PolicyStatement({
                actions: ['ssm:GetParameter'],
                resources: [allowLinkBookingsParameter.parameterArn],
            }),
        );

        this.guestBookedSeatsFunction.addToRolePolicy(
            new iam.PolicyStatement({
                actions: ['cognito-idp:AdminGetUser'],
                resources: [props.userPool.userPoolArn],
            }),
        );

        this.guestBookingFunction = createNodejsFunction(this, 'GuestBookingHandler', {
            functionName: formatLambdaFunctionName('blockbuster-theatre-guest-booking-handler'),
            runtime: lambdaSettings.runtime,
            entry: path.join(
                __dirname,
                '../../src/main/lambda/handlers/GuestBooking/guest-booking-handler.ts',
            ),
            handler: 'handler',
            bundling: pdfKitBundling,
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
                GUEST_CONVERSION_TOKENS_TABLE_NAME: props.guestConversionTokensTable.tableName,
                BOOKING_EMAIL_FROM: props.bookingEmailIdentity.emailIdentityName,
                MAX_TICKETS_PARAMETER_NAME: scopedMaxTicketsParameterName,
            },
        });

        props.table.grantReadData(this.guestBookingFunction);
        props.pricingTable.grantReadData(this.guestBookingFunction);
        props.offersTable.grantReadData(this.guestBookingFunction);
        props.bookingsTable.grantWriteData(this.guestBookingFunction);
        props.legacyBookingsTable.grantReadData(this.guestBookingFunction);
        props.showtimeRegistryTable.grantReadData(this.guestBookingFunction);
        props.bookingReferencesTable.grantWriteData(this.guestBookingFunction);
        props.guestConversionTokensTable.grantWriteData(this.guestBookingFunction);
        props.bookingEmailIdentity.grantSendEmail(this.guestBookingFunction);
        maxTicketsParameter.grantRead(this.guestBookingFunction);

        this.guestConversionFunction = createNodejsFunction(this, 'GuestConversionHandler', {
            functionName: formatLambdaFunctionName('blockbuster-theatre-guest-conversion-handler'),
            runtime: lambdaSettings.runtime,
            entry: path.join(
                __dirname,
                '../../src/main/lambda/handlers/GuestConversion/guest-conversion-handler.ts',
            ),
            handler: 'handler',
            memorySize: lambdaSettings.default.memorySize,
            timeout: cdk.Duration.seconds(lambdaSettings.default.timeoutSeconds),
            environment: {
                BOOKINGS_TABLE_NAME: props.bookingsTable.tableName,
                LEGACY_BOOKINGS_TABLE_NAME: props.legacyBookingsTable.tableName,
                SHOWTIME_REGISTRY_TABLE_NAME: props.showtimeRegistryTable.tableName,
                GUEST_CONVERSION_TOKENS_TABLE_NAME: props.guestConversionTokensTable.tableName,
                USER_POOL_ID: props.userPool.userPoolId,
                USER_POOL_CLIENT_ID: props.userPoolClient.userPoolClientId,
            },
        });

        props.bookingsTable.grantReadWriteData(this.guestConversionFunction);
        props.legacyBookingsTable.grantReadWriteData(this.guestConversionFunction);
        props.showtimeRegistryTable.grantReadData(this.guestConversionFunction);
        props.guestConversionTokensTable.grantReadWriteData(this.guestConversionFunction);
        this.guestConversionFunction.addToRolePolicy(
            new iam.PolicyStatement({
                actions: ['cognito-idp:AdminCreateUser','cognito-idp:AdminGetUser','cognito-idp:AdminInitiateAuth','cognito-idp:AdminSetUserPassword',],
                resources: [props.userPool.userPoolArn],
            }),
        );

        this.downloadTicketFunction = createNodejsFunction(this, 'DownloadTicketHandler', {
            functionName: formatLambdaFunctionName('blockbuster-theatre-download-ticket-handler'),
            runtime: lambdaSettings.runtime,
            entry: path.join(
                __dirname,
                '../../src/main/lambda/handlers/DownloadTicket/download-ticket-handler.ts',
            ),
            handler: 'handler',
            bundling: pdfKitBundling,
            memorySize: lambdaSettings.default.memorySize,
            timeout: cdk.Duration.seconds(lambdaSettings.default.timeoutSeconds),
            environment: {
                BOOKINGS_TABLE_NAME: props.bookingsTable.tableName,
                LEGACY_BOOKINGS_TABLE_NAME: props.legacyBookingsTable.tableName,
            },
        });

        props.bookingsTable.grantReadData(this.downloadTicketFunction);
        props.legacyBookingsTable.grantReadData(this.downloadTicketFunction);
    }
}
