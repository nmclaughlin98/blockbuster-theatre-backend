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
import {
    lambdaSettings,
    maxTicketsParameterName,
    movieImportLambdaConfig as cfg,
    movieUpdateMaxBatch,
    type MovieImportLambdaConfig,
} from '../../../lib/stack/lambda';
import {
    maxTicketsParameterForEnvironment,
    resourceName,
    type EnvironmentName,
} from '../../../lib/stack/environment';

interface LambdaConstructProps {
    table: dynamodb.Table;
    pricingTable: dynamodb.Table;
    offersTable: dynamodb.Table;
    collectionsTable: dynamodb.Table;
    bookingsTable: dynamodb.Table;
    showtimeRegistryTable: dynamodb.Table;
    guestConversionTokensTable: dynamodb.Table;
    userPool: cognito.IUserPool;
    userPoolClient: cognito.IUserPoolClient;
    postmanClientId: string;
    bookingEmailIdentity: ses.IEmailIdentity;
    lambdaConfig?: MovieImportLambdaConfig;
    envName?: EnvironmentName;
}

function createNodejsFunction(
    scope: Construct,
    id: string,
    props: lambdaNodejs.NodejsFunctionProps
): lambdaNodejs.NodejsFunction {
    if (!props.functionName) {
        throw new Error(`Function ${id} must have a name to configure its log group.`);
    }

    const logGroup = new logs.LogGroup(scope, `${id}LogGroup`, {
        logGroupName: `/aws/lambda/${props.functionName}`,
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    return new lambdaNodejs.NodejsFunction(scope, id, {
        ...props,
        architecture: props.architecture ?? lambda.Architecture.ARM_64,
        logGroup,
    });
}

export class LambdaConstruct extends Construct {
    public readonly addMoviesFunction: lambdaNodejs.NodejsFunction;
    public readonly updateMoviesFunction: lambdaNodejs.NodejsFunction;
    public readonly listMoviesFunction: lambdaNodejs.NodejsFunction;
    public readonly getMovieFunction: lambdaNodejs.NodejsFunction;
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
    public readonly getBookingFunction: lambdaNodejs.NodejsFunction;
    public readonly rescheduleBookingFunction: lambdaNodejs.NodejsFunction;
    public readonly createShowtimeFunction: lambdaNodejs.NodejsFunction;
    public readonly updateShowtimeFunction: lambdaNodejs.NodejsFunction;
    public readonly cancelShowtimeFunction: lambdaNodejs.NodejsFunction;
    public readonly maintainScheduleFunction: lambdaNodejs.NodejsFunction;
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
        const lambdaConfig = props.lambdaConfig ?? cfg;
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
        const cognitoEnvironment = {
            USER_POOL_ID: props.userPool.userPoolId,
            USER_POOL_CLIENT_ID: props.userPoolClient.userPoolClientId,
            POSTMAN_CLIENT_ID: props.postmanClientId,
        };
        const scopedMaxTicketsParameterName = maxTicketsParameterForEnvironment(
            maxTicketsParameterName,
            envName
        );
        // PDFKit resolves its fonts and other assets relative to its installed package.
        const pdfKitBundling = { nodeModules: ['pdfkit'] };
        const maxTicketsParameter = ssm.StringParameter.fromStringParameterName(
            this,
            'MaxTicketsParameter',
            scopedMaxTicketsParameterName
        );
        const allowLinkBookingsParameterName = envName === 'prod'
            ? '/blockbuster-theatre/parameter-configurations/ALLOW_LINK_BOOKINGS'
            : '/blockbuster-theatre/parameter-configurations-dev/ALLOW_LINK_BOOKINGS';
        const allowLinkBookingsParameter = ssm.StringParameter.fromStringParameterName(
            this,
            'AllowLinkBookingsParameter',
            allowLinkBookingsParameterName
        );

        this.addMoviesFunction = createNodejsFunction(this, 'AddMovieToDbFunction', {
            functionName: formatLambdaFunctionName('blockbuster-theatre-add-movie-to-db'),
            runtime: lambdaSettings.runtime,
            entry: path.join(__dirname, '../../handlers/movies/add-movie-to-db.ts'),
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

        this.updateMoviesFunction = createNodejsFunction(this, 'UpdateMovieRecordFunction', {
            functionName: formatLambdaFunctionName('blockbuster-theatre-update-movie-record'),
            runtime: lambdaSettings.runtime,
            entry: path.join(__dirname, '../../handlers/movies/update-movie-record.ts'),
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

        this.listMoviesFunction = createNodejsFunction(this, 'ListMovieRecordsFunction', {
            functionName: formatLambdaFunctionName('blockbuster-theatre-list-movie-records'),
            runtime: lambdaSettings.runtime,
            entry: path.join(__dirname, '../../handlers/movies/list-movie-records.ts'),
            handler: 'handler',
            memorySize: lambdaSettings.default.memorySize,
            timeout: cdk.Duration.seconds(lambdaSettings.default.timeoutSeconds),
            environment: {
                TABLE_NAME: props.table.tableName,
                SHOWTIME_REGISTRY_TABLE_NAME: props.showtimeRegistryTable.tableName,
                ...cognitoEnvironment,
            },
        });

        props.table.grantReadData(this.listMoviesFunction);
        props.showtimeRegistryTable.grantReadWriteData(this.listMoviesFunction);

        this.getMovieFunction = createNodejsFunction(this, 'GetMovieRecordFunction', {
            functionName: formatLambdaFunctionName('blockbuster-theatre-get-movie-record'),
            runtime: lambdaSettings.runtime,
            entry: path.join(__dirname, '../../handlers/movies/get-movie-record.ts'),
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

        this.listMovieCollectionsFunction = createNodejsFunction(
            this,
            'ListCollectionRecordsFunction',
            {
                functionName: formatLambdaFunctionName('blockbuster-theatre-list-collection-records'),
                runtime: lambdaSettings.runtime,
                entry: path.join(__dirname, '../../handlers/collections/list-collection-records.ts'),
                handler: 'handler',
                memorySize: lambdaSettings.default.memorySize,
                timeout: cdk.Duration.seconds(lambdaSettings.default.timeoutSeconds),
                environment: {
                    COLLECTIONS_TABLE_NAME: props.collectionsTable.tableName,
                },
            }
        );

        props.collectionsTable.grantReadData(this.listMovieCollectionsFunction);

        this.getMovieCollectionFunction = createNodejsFunction(
            this,
            'GetCollectionRecordFunction',
            {
                functionName: formatLambdaFunctionName('blockbuster-theatre-get-collection-record'),
                runtime: lambdaSettings.runtime,
                entry: path.join(__dirname, '../../handlers/collections/get-collection-record.ts'),
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

        this.listFilmSelectionsFunction = createNodejsFunction(
            this,
            'ListCheckoutSelectionsFunction',
            {
                functionName: formatLambdaFunctionName('blockbuster-theatre-list-checkout-selections'),
                runtime: lambdaSettings.runtime,
                entry: path.join(__dirname, '../../handlers/checkout/list-checkout-selections.ts'),
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

        this.getTicketPricingFunction = createNodejsFunction(
            this,
            'GetTicketPricingFunction',
            {
                functionName: formatLambdaFunctionName('blockbuster-theatre-get-ticket-pricing'),
                runtime: lambdaSettings.runtime,
                entry: path.join(__dirname, '../../handlers/pricing/get-ticket-pricing.ts'),
                handler: 'handler',
                memorySize: lambdaSettings.default.memorySize,
                timeout: cdk.Duration.seconds(lambdaSettings.default.timeoutSeconds),
                environment: {
                    TABLE_NAME: props.table.tableName,
                    PRICING_TABLE_NAME: props.pricingTable.tableName,
                    OFFERS_TABLE_NAME: props.offersTable.tableName,
                    SHOWTIME_REGISTRY_TABLE_NAME: props.showtimeRegistryTable.tableName,
                },
            }
        );

        props.table.grantReadData(this.getTicketPricingFunction);
        props.pricingTable.grantReadData(this.getTicketPricingFunction);
        props.offersTable.grantReadData(this.getTicketPricingFunction);
        props.showtimeRegistryTable.grantReadWriteData(this.getTicketPricingFunction);

        this.validateCheckoutFunction = createNodejsFunction(
            this,
            'ValidateCheckoutFunction',
            {
                functionName: formatLambdaFunctionName('blockbuster-theatre-validate-checkout'),
                runtime: lambdaSettings.runtime,
                entry: path.join(__dirname, '../../handlers/checkout/validate-checkout.ts'),
                handler: 'handler',
                memorySize: lambdaSettings.default.memorySize,
                timeout: cdk.Duration.seconds(lambdaSettings.default.timeoutSeconds),
                environment: {
                    TABLE_NAME: props.table.tableName,
                    PRICING_TABLE_NAME: props.pricingTable.tableName,
                    OFFERS_TABLE_NAME: props.offersTable.tableName,
                    SHOWTIME_REGISTRY_TABLE_NAME: props.showtimeRegistryTable.tableName,
                },
            }
        );

        props.table.grantReadData(this.validateCheckoutFunction);
        props.pricingTable.grantReadData(this.validateCheckoutFunction);
        props.offersTable.grantReadData(this.validateCheckoutFunction);
        props.showtimeRegistryTable.grantReadWriteData(this.validateCheckoutFunction);

        this.sendBookingConfirmationFunction = createNodejsFunction(
            this,
            'SendBookingConfirmationFunction',
            {
                functionName: formatLambdaFunctionName('blockbuster-theatre-send-booking-confirmation'),
                runtime: lambdaSettings.runtime,
                entry: path.join(__dirname, '../../handlers/bookings/send-booking-confirmation.ts'),
                handler: 'handler',
                bundling: pdfKitBundling,
                memorySize: lambdaSettings.default.memorySize,
                timeout: cdk.Duration.seconds(lambdaSettings.default.timeoutSeconds),
                environment: {
                    BOOKING_EMAIL_FROM: props.bookingEmailIdentity.emailIdentityName,
                    BOOKINGS_TABLE_NAME: props.bookingsTable.tableName,
                    ...cognitoEnvironment,
                },
            }
        );

        props.bookingEmailIdentity.grantSendEmail(this.sendBookingConfirmationFunction);
        props.bookingsTable.grantReadData(this.sendBookingConfirmationFunction);

        this.upsertBookingOffersFunction = createNodejsFunction(
            this,
            'UpsertBookingOffersFunction',
            {
                functionName: formatLambdaFunctionName('blockbuster-theatre-upsert-booking-offers'),
                runtime: lambdaSettings.runtime,
                entry: path.join(__dirname, '../../handlers/offers/upsert-booking-offers.ts'),
                handler: 'handler',
                memorySize: lambdaSettings.default.memorySize,
                timeout: cdk.Duration.seconds(lambdaSettings.default.timeoutSeconds),
                environment: {
                    OFFERS_TABLE_NAME: props.offersTable.tableName,
                },
            }
        );

        props.offersTable.grantReadWriteData(this.upsertBookingOffersFunction);

        this.upsertTicketPricingFunction = createNodejsFunction(
            this,
            'UpsertTicketPricingFunction',
            {
                functionName: formatLambdaFunctionName('blockbuster-theatre-upsert-ticket-pricing'),
                runtime: lambdaSettings.runtime,
                entry: path.join(__dirname, '../../handlers/pricing/upsert-ticket-pricing.ts'),
                handler: 'handler',
                memorySize: lambdaSettings.default.memorySize,
                timeout: cdk.Duration.seconds(lambdaSettings.default.timeoutSeconds),
                environment: {
                    PRICING_TABLE_NAME: props.pricingTable.tableName,
                },
            }
        );

        props.pricingTable.grantReadWriteData(this.upsertTicketPricingFunction);

        this.refreshMovieCollectionFunction = createNodejsFunction(
            this,
            'RefreshCollectionRecordsFunction',
            {
                functionName: formatLambdaFunctionName('blockbuster-theatre-refresh-collection-records'),
                runtime: lambdaSettings.runtime,
                entry: path.join(__dirname, '../../handlers/collections/refresh-collection-records.ts'),
                handler: 'handler',
                memorySize: lambdaSettings.collectionRefresh.memorySize,
                timeout: cdk.Duration.seconds(lambdaSettings.collectionRefresh.timeoutSeconds),
                environment: {
                    COLLECTIONS_TABLE_NAME: props.collectionsTable.tableName,
                    TMDB_API_KEY: tmdbApiKey,
                    TMDB_TIMEOUT_MS: String(lambdaConfig.tmdbTimeoutMs),
                    TMDB_RETRIES: String(lambdaConfig.tmdbRetries),
                },
            }
        );

        props.collectionsTable.grantReadWriteData(this.refreshMovieCollectionFunction);

        this.rescheduleBookingFunction = createNodejsFunction(this, 'RescheduleBookingRecordFunction', {
            functionName: formatLambdaFunctionName('blockbuster-theatre-reschedule-booking-record'),
            runtime: lambdaSettings.runtime,
            entry: path.join(__dirname, '../../handlers/bookings/reschedule-booking-record.ts'),
            handler: 'handler',
            memorySize: lambdaSettings.default.memorySize,
            timeout: cdk.Duration.seconds(lambdaSettings.default.timeoutSeconds),
            environment: {
                BOOKINGS_TABLE_NAME: props.bookingsTable.tableName,
                SHOWTIME_REGISTRY_TABLE_NAME: props.showtimeRegistryTable.tableName,
                TABLE_NAME: props.table.tableName,
            },
        });
        props.bookingsTable.grant(
            this.rescheduleBookingFunction,
            'dynamodb:GetItem',
            'dynamodb:DeleteItem',
            'dynamodb:PutItem'
        );
        props.showtimeRegistryTable.grantReadData(this.rescheduleBookingFunction);
        props.showtimeRegistryTable.grant(
            this.rescheduleBookingFunction,
            'dynamodb:ConditionCheckItem'
        );
        props.table.grant(this.rescheduleBookingFunction, 'dynamodb:GetItem', 'dynamodb:ConditionCheckItem');

        const showtimeFunction = (id: string, operation: string): lambdaNodejs.NodejsFunction => {
            const fn = createNodejsFunction(this, id, {
            functionName: formatLambdaFunctionName(`blockbuster-theatre-${operation}`),
            runtime: lambdaSettings.runtime,
            entry: path.join(__dirname, `../../handlers/showtimes/${operation}.ts`),
            handler: 'handler',
            memorySize: lambdaSettings.default.memorySize,
            timeout: cdk.Duration.seconds(lambdaSettings.default.timeoutSeconds),
            environment: {
                TABLE_NAME: props.table.tableName,
                SHOWTIME_REGISTRY_TABLE_NAME: props.showtimeRegistryTable.tableName,
                BOOKINGS_TABLE_NAME: props.bookingsTable.tableName,
            },
        });
            props.table.grantReadData(fn);
            props.showtimeRegistryTable.grantReadWriteData(fn);
            props.bookingsTable.grantReadData(fn);
            return fn;
        };
        this.createShowtimeFunction = showtimeFunction('CreateShowtimeRecordFunction', 'create-showtime-record');
        this.updateShowtimeFunction = showtimeFunction('UpdateShowtimeRecordFunction', 'update-showtime-record');
        this.cancelShowtimeFunction = showtimeFunction('CancelShowtimeRecordFunction', 'cancel-showtime-record');

        this.maintainScheduleFunction = createNodejsFunction(this, 'MaintainRollingScheduleFunction', {
            functionName: formatLambdaFunctionName('blockbuster-theatre-maintain-rolling-schedule'),
            runtime: lambdaSettings.runtime,
            entry: path.join(__dirname, '../../handlers/showtimes/maintain-rolling-schedule.ts'),
            handler: 'handler',
            memorySize: 512,
            timeout: cdk.Duration.minutes(15),
            environment: {
                TABLE_NAME: props.table.tableName,
                SHOWTIME_REGISTRY_TABLE_NAME: props.showtimeRegistryTable.tableName,
                BOOKINGS_TABLE_NAME: props.bookingsTable.tableName,
            },
        });
        props.table.grantReadData(this.maintainScheduleFunction);
        props.showtimeRegistryTable.grantReadWriteData(this.maintainScheduleFunction);
        props.bookingsTable.grantReadData(this.maintainScheduleFunction);

        new events.Rule(this, 'MaintainRollingScheduleRule', {
            schedule: events.Schedule.rate(cdk.Duration.hours(6)),
            targets: [new targets.LambdaFunction(this.maintainScheduleFunction)],
        });

        this.listBookingsFunction = createNodejsFunction(
            this,
            'ListBookingRecordsFunction',
            {
                functionName: formatLambdaFunctionName('blockbuster-theatre-list-booking-records'),
                runtime: lambdaSettings.runtime,
                entry: path.join(__dirname, '../../handlers/bookings/list-booking-records.ts'),
                handler: 'handler',
                bundling: pdfKitBundling,
                memorySize: lambdaSettings.default.memorySize,
                timeout: cdk.Duration.seconds(25),
                environment: {
                    BOOKINGS_TABLE_NAME: props.bookingsTable.tableName,
                    SHOWTIME_REGISTRY_TABLE_NAME: props.showtimeRegistryTable.tableName,
                    BOOKING_EMAIL_FROM: props.bookingEmailIdentity.emailIdentityName,
                    ALLOW_LINK_BOOKINGS_PARAMETER_NAME: allowLinkBookingsParameterName,
                    ...cognitoEnvironment,
                },
            }
        );
        props.bookingsTable.grantReadWriteData(this.listBookingsFunction);
        props.showtimeRegistryTable.grantReadData(this.listBookingsFunction);
        props.bookingEmailIdentity.grantSendEmail(this.listBookingsFunction);
        this.listBookingsFunction.addToRolePolicy(new iam.PolicyStatement({
            actions: ['ssm:GetParameter'],
            resources: [allowLinkBookingsParameter.parameterArn],
        }));

        this.createBookingFunction = createNodejsFunction(
            this,
            'CreateBookingRecordFunction',
            {
                functionName: formatLambdaFunctionName('blockbuster-theatre-create-booking-record'),
                runtime: lambdaSettings.runtime,
                entry: path.join(__dirname, '../../handlers/bookings/create-booking-record.ts'),
                handler: 'handler',
                bundling: pdfKitBundling,
                memorySize: lambdaSettings.default.memorySize,
                timeout: cdk.Duration.seconds(lambdaSettings.default.timeoutSeconds),
                environment: {
                    TABLE_NAME: props.table.tableName,
                    PRICING_TABLE_NAME: props.pricingTable.tableName,
                    OFFERS_TABLE_NAME: props.offersTable.tableName,
                    BOOKINGS_TABLE_NAME: props.bookingsTable.tableName,
                    SHOWTIME_REGISTRY_TABLE_NAME: props.showtimeRegistryTable.tableName,
                    GUEST_CONVERSION_TOKENS_TABLE_NAME:
                        props.guestConversionTokensTable.tableName,
                    BOOKING_EMAIL_FROM: props.bookingEmailIdentity.emailIdentityName,
                    MAX_TICKETS_PARAMETER_NAME: scopedMaxTicketsParameterName,
                    ...cognitoEnvironment,
                },
            }
        );
        props.table.grantReadData(this.createBookingFunction);
        props.pricingTable.grantReadData(this.createBookingFunction);
        props.offersTable.grantReadData(this.createBookingFunction);
        props.bookingsTable.grantWriteData(this.createBookingFunction);
        props.showtimeRegistryTable.grantReadData(this.createBookingFunction);
        props.showtimeRegistryTable.grant(this.createBookingFunction, 'dynamodb:ConditionCheckItem');
        props.guestConversionTokensTable.grantWriteData(this.createBookingFunction);
        props.bookingEmailIdentity.grantSendEmail(this.createBookingFunction);
        maxTicketsParameter.grantRead(this.createBookingFunction);

        this.getBookingFunction = createNodejsFunction(this, 'GetBookingRecordFunction', {
            functionName: formatLambdaFunctionName('blockbuster-theatre-get-booking-record'),
            runtime: lambdaSettings.runtime,
            entry: path.join(__dirname, '../../handlers/bookings/get-booking-record.ts'),
            handler: 'handler',
            memorySize: lambdaSettings.default.memorySize,
            timeout: cdk.Duration.seconds(lambdaSettings.default.timeoutSeconds),
            environment: { BOOKINGS_TABLE_NAME: props.bookingsTable.tableName, ...cognitoEnvironment },
        });
        props.bookingsTable.grantReadData(this.getBookingFunction);

        this.guestConversionFunction = createNodejsFunction(
            this,
            'ConvertGuestBookingsToRegisteredAccountFunction',
            {
                functionName: formatLambdaFunctionName('blockbuster-theatre-convert-guest-bookings-to-account'),
                runtime: lambdaSettings.runtime,
                entry: path.join(__dirname, '../../handlers/auth/convert-guest-bookings-to-registered-account.ts'),
                handler: 'handler',
                memorySize: lambdaSettings.default.memorySize,
                timeout: cdk.Duration.seconds(lambdaSettings.default.timeoutSeconds),
                environment: {
                    BOOKINGS_TABLE_NAME: props.bookingsTable.tableName,
                    SHOWTIME_REGISTRY_TABLE_NAME: props.showtimeRegistryTable.tableName,
                    GUEST_CONVERSION_TOKENS_TABLE_NAME:
                        props.guestConversionTokensTable.tableName,
                    USER_POOL_ID: props.userPool.userPoolId,
                    USER_POOL_CLIENT_ID: props.userPoolClient.userPoolClientId,
                },
            }
        );
        props.bookingsTable.grantReadWriteData(this.guestConversionFunction);
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

        this.downloadTicketFunction = createNodejsFunction(
            this,
            'DownloadBookingTicketFunction',
            {
                functionName: formatLambdaFunctionName('blockbuster-theatre-download-booking-ticket'),
                runtime: lambdaSettings.runtime,
                entry: path.join(__dirname, '../../handlers/bookings/download-booking-ticket.ts'),
                handler: 'handler',
                bundling: pdfKitBundling,
                memorySize: lambdaSettings.default.memorySize,
                timeout: cdk.Duration.seconds(lambdaSettings.default.timeoutSeconds),
                environment: {
                    BOOKINGS_TABLE_NAME: props.bookingsTable.tableName,
                    ...cognitoEnvironment,
                },
            }
        );
        props.bookingsTable.grantReadData(this.downloadTicketFunction);
    }
}