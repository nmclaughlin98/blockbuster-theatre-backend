import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { LambdaConstruct } from '../../../lib/stack';
import { movieImportLambdaConfig as cfg } from '../../../lib/stack/lambda';

describe('LambdaConstruct', () => {
    let stack: cdk.Stack;
    let table: dynamodb.Table;
    let pricingTable: dynamodb.Table;
    let offersTable: dynamodb.Table;
    let construct: LambdaConstruct;

    beforeEach(() => {
        stack = new cdk.Stack();
        table = new dynamodb.Table(stack, 'TestTable', {
            partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        });
        pricingTable = new dynamodb.Table(stack, 'TestPricingTable', {
            partitionKey: { name: 'pricingId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        });
        offersTable = new dynamodb.Table(stack, 'TestOffersTable', {
            partitionKey: { name: 'offerId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        });
        construct = new LambdaConstruct(stack, 'TestLambda', { table, pricingTable, offersTable });
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

    it('should not set reserved concurrency by default', () => {
        const template = Template.fromStack(stack);
        const functions = template.findResources('AWS::Lambda::Function');
        expect(Object.values(functions)).toHaveLength(11);
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

        new LambdaConstruct(configuredStack, 'ConfiguredLambda', {
            table: configuredTable,
            pricingTable: configuredPricingTable,
            offersTable: configuredOffersTable,
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
        expect(construct.upsertBookingOffersFunction).toBeDefined();
        expect(construct.upsertTicketPricingFunction).toBeDefined();
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
