import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ses from 'aws-cdk-lib/aws-ses';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { LambdaConstruct } from '../../../lib/stack';
import {
    movieImportLambdaConfig as cfg,
    movieUpdateMaxBatch,
} from '../../../lib/stack/lambda';

describe('LambdaConstruct', () => {
    let stack: cdk.Stack;
    let table: dynamodb.Table;
    let pricingTable: dynamodb.Table;
    let offersTable: dynamodb.Table;
    let collectionsTable: dynamodb.Table;
    let bookingsTable: dynamodb.Table;
    let guestConversionTokensTable: dynamodb.Table;
    let userPool: cognito.UserPool;
    let userPoolClient: cognito.UserPoolClient;
    let bookingEmailIdentity: ses.EmailIdentity;
    let construct: LambdaConstruct;

    beforeEach(() => {
        stack = new cdk.Stack();
        table = new dynamodb.Table(stack, 'TestTable', {
            partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        });
        guestConversionTokensTable = new dynamodb.Table(
            stack,
            'TestGuestConversionTokensTable',
            {
                partitionKey: { name: 'tokenHash', type: dynamodb.AttributeType.STRING },
                billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            }
        );
        userPool = new cognito.UserPool(stack, 'TestUserPool', {
            selfSignUpEnabled: false,
            signInAliases: { email: true },
        });
        userPoolClient = userPool.addClient('TestUserPoolClient', {
            authFlows: { adminUserPassword: true },
        });
        pricingTable = new dynamodb.Table(stack, 'TestPricingTable', {
            partitionKey: { name: 'pricingId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        });
        offersTable = new dynamodb.Table(stack, 'TestOffersTable', {
            partitionKey: { name: 'offerId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        });

        collectionsTable = new dynamodb.Table(stack, 'TestCollectionsTable', {
            partitionKey: { name: 'collectionId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        });
        bookingsTable = new dynamodb.Table(stack, 'TestBookingsTable', {
            partitionKey: { name: 'showingId', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'seatId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        });
        bookingEmailIdentity = new ses.EmailIdentity(stack, 'TestBookingEmailIdentity', {
            identity: ses.Identity.email('booking@example.com'),
        });
        construct = new LambdaConstruct(stack, 'TestLambda', {
            table,
            pricingTable,
            offersTable,
            collectionsTable,
            bookingsTable,
            guestConversionTokensTable,
            userPool,
            userPoolClient,
            bookingEmailIdentity,
        });
    });

    it('should create a Lambda function', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Lambda::Function', {
            FunctionName: 'blockbuster-theatre-add-movies-handler',
        });
    });

    it('should use Node.js 24.x runtime', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Lambda::Function', {
            Runtime: 'nodejs24.x',
        });
    });

    it('should set correct memory size', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Lambda::Function', {
            MemorySize: 512,
        });
    });

    it('should set correct timeout', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Lambda::Function', {
            Timeout: 25,
        });
    });

    it('should allow movie imports of up to 100 movies', () => {
        expect(cfg.maxBatch).toBe(100);
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Lambda::Function', {
            FunctionName: 'blockbuster-theatre-add-movies-handler',
            Environment: {
                Variables: Match.objectLike({ MAX_BATCH: '100' }),
            },
        });
    });

    it('should keep movie updates capped at 25 movies', () => {
        expect(movieUpdateMaxBatch).toBe(25);
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Lambda::Function', {
            FunctionName: 'blockbuster-theatre-update-movies-handler',
            Environment: {
                Variables: Match.objectLike({ MAX_BATCH: '25' }),
            },
        });
    });

    it('should use default sizing for lightweight API handlers', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Lambda::Function', {
            FunctionName: 'blockbuster-theatre-list-movies-handler',
            MemorySize: 256,
            Timeout: 10,
        });
        template.hasResourceProperties('AWS::Lambda::Function', {
            FunctionName: 'blockbuster-theatre-list-featured-movies-handler',
            MemorySize: 256,
            Timeout: 10,
        });
        template.hasResourceProperties('AWS::Lambda::Function', {
            FunctionName: 'blockbuster-theatre-get-movie-collection-handler',
            MemorySize: 256,
            Timeout: 25,
        });
        template.hasResourceProperties('AWS::Lambda::Function', {
            FunctionName: 'blockbuster-theatre-refresh-movie-collection-handler',
            MemorySize: 512,
            Timeout: 25,
        });
        template.hasResourceProperties('AWS::Lambda::Function', {
            FunctionName: 'blockbuster-theatre-export-movies-handler',
            MemorySize: 512,
            Timeout: 25,
        });
        template.hasResourceProperties('AWS::Lambda::Function', {
            FunctionName: 'blockbuster-theatre-update-movies-handler',
            MemorySize: 256,
            Timeout: 15,
        });
    });

    it('should set environment variables for movie imports', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Lambda::Function', {
            FunctionName: 'blockbuster-theatre-add-movies-handler',
            Environment: {
                Variables: Match.objectLike({
                    TABLE_NAME: Match.anyValue(),
                    MAX_BATCH: String(cfg.maxBatch),
                    TMDB_CONCURRENCY: '5',
                    TMDB_TIMEOUT_MS: '4000',
                    TMDB_RETRIES: '3',
                }),
            },
        });
    });

    it('should configure the TMDB collection refresh function', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Lambda::Function', {
            FunctionName: 'blockbuster-theatre-refresh-movie-collection-handler',
            Environment: {
                Variables: Match.objectLike({
                    COLLECTIONS_TABLE_NAME: Match.anyValue(),
                    TMDB_API_KEY: Match.anyValue(),
                    TMDB_TIMEOUT_MS: '4000',
                    TMDB_RETRIES: '3',
                }),
            },
        });
    });

    it('should not set reserved concurrency by default', () => {
        const template = Template.fromStack(stack);
        const functions = template.findResources('AWS::Lambda::Function');
        expect(Object.values(functions)).toHaveLength(21);
        expect(Object.values(functions)[0].Properties).not.toHaveProperty('ReservedConcurrentExecutions');
    });

    it('should set reserved concurrency when explicitly configured', () => {
        const configuredStack = new cdk.Stack();
        const configuredTable = new dynamodb.Table(configuredStack, 'ConfiguredTable', {
            partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        });
        const configuredPricingTable = new dynamodb.Table(configuredStack, 'ConfiguredPricingTable', {
            partitionKey: { name: 'pricingId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        });
        const configuredOffersTable = new dynamodb.Table(configuredStack, 'ConfiguredOffersTable', {
            partitionKey: { name: 'offerId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        });
        const configuredCollectionsTable = new dynamodb.Table(
            configuredStack,
            'ConfiguredCollectionsTable',
            {
                partitionKey: { name: 'collectionId', type: dynamodb.AttributeType.STRING },
                billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            }
        );
        const configuredBookingsTable = new dynamodb.Table(configuredStack, 'ConfiguredBookingsTable', {
            partitionKey: { name: 'showingId', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'seatId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        });
        const configuredGuestConversionTokensTable = new dynamodb.Table(
            configuredStack,
            'ConfiguredGuestConversionTokensTable',
            {
                partitionKey: { name: 'tokenHash', type: dynamodb.AttributeType.STRING },
                billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            }
        );
        const configuredUserPool = new cognito.UserPool(configuredStack, 'ConfiguredUserPool', {
            selfSignUpEnabled: false,
            signInAliases: { email: true },
        });
        const configuredUserPoolClient = configuredUserPool.addClient(
            'ConfiguredUserPoolClient',
            { authFlows: { adminUserPassword: true } }
        );
        const configuredBookingEmailIdentity = new ses.EmailIdentity(
            configuredStack,
            'ConfiguredBookingEmailIdentity',
            { identity: ses.Identity.email('booking@example.com') }
        );

        new LambdaConstruct(configuredStack, 'ConfiguredLambda', {
            table: configuredTable,
            pricingTable: configuredPricingTable,
            offersTable: configuredOffersTable,
            collectionsTable: configuredCollectionsTable,
            bookingsTable: configuredBookingsTable,
            guestConversionTokensTable: configuredGuestConversionTokensTable,
            userPool: configuredUserPool,
            userPoolClient: configuredUserPoolClient,
            bookingEmailIdentity: configuredBookingEmailIdentity,
            lambdaConfig: {
                ...cfg,
                reservedConcurrentExecutions: 3,
            },
        });

        const template = Template.fromStack(configuredStack);
        template.hasResourceProperties('AWS::Lambda::Function', {
            ReservedConcurrentExecutions: 3,
        });
    });

    it('should export addMoviesFunction', () => {
        expect(construct.addMoviesFunction).toBeDefined();
    });

    it('should export updateMoviesFunction', () => {
        expect(construct.updateMoviesFunction).toBeDefined();
    });

    it('should export listMoviesFunction', () => {
        expect(construct.listMoviesFunction).toBeDefined();
    });

    it('should export listFeaturedMoviesFunction', () => {
        expect(construct.listFeaturedMoviesFunction).toBeDefined();
    });

    it('should export getMovieFunction', () => {
        expect(construct.getMovieFunction).toBeDefined();
    });

    it('should export exportMoviesFunction', () => {
        expect(construct.exportMoviesFunction).toBeDefined();
    });

    it('should export listTmdbIdsFunction', () => {
        expect(construct.listTmdbIdsFunction).toBeDefined();
    });

    it('should export special offers functions', () => {
        expect(construct.listFilmSelectionsFunction).toBeDefined();
        expect(construct.getTicketPricingFunction).toBeDefined();
        expect(construct.validateCheckoutFunction).toBeDefined();
        expect(construct.sendBookingConfirmationFunction).toBeDefined();
        expect(construct.upsertBookingOffersFunction).toBeDefined();
        expect(construct.upsertTicketPricingFunction).toBeDefined();
    });

    it('should export collection functions', () => {
        expect(construct.getMovieCollectionFunction).toBeDefined();
        expect(construct.refreshMovieCollectionFunction).toBeDefined();
    });

    it('should export the guest booking and conversion functions', () => {
        expect(construct.guestBookedSeatsFunction).toBeDefined();
        expect(construct.guestBookingFunction).toBeDefined();
        expect(construct.guestConversionFunction).toBeDefined();
    });

    it('should configure booking functions with least-privilege table access', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Lambda::Function', {
            FunctionName: 'blockbuster-theatre-list-bookings-handler',
            Environment: {
                Variables: { BOOKINGS_TABLE_NAME: { Ref: Match.stringLikeRegexp('TestBookingsTable') } },
            },
        });
        template.hasResourceProperties('AWS::Lambda::Function', {
            FunctionName: 'blockbuster-theatre-create-booking-handler',
            Environment: {
                Variables: Match.objectLike({
                    BOOKINGS_TABLE_NAME: { Ref: Match.stringLikeRegexp('TestBookingsTable') },
                    TABLE_NAME: Match.anyValue(),
                    PRICING_TABLE_NAME: Match.anyValue(),
                    OFFERS_TABLE_NAME: Match.anyValue(),
                }),
            },
        });
        expect(construct.listBookingsFunction).toBeDefined();
        expect(construct.createBookingFunction).toBeDefined();
    });

    it('should grant read/write permissions to DynamoDB', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::IAM::Policy', {
            PolicyDocument: Match.objectLike({
                Statement: Match.arrayWith([
                    Match.objectLike({
                        Action: Match.arrayWith([
                            'dynamodb:BatchGetItem',
                            'dynamodb:BatchWriteItem',
                        ]),
                    }),
                ]),
            }),
        });
    });

    it('should have handler set to "handler"', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Lambda::Function', {
            Handler: 'index.handler',
        });
    });
});
