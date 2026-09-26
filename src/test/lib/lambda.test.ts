import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { LambdaConstruct } from '../../../lib/stack';

describe('LambdaConstruct', () => {
    let stack: cdk.Stack;
    let table: dynamodb.Table;
    let construct: LambdaConstruct;

    beforeEach(() => {
        stack = new cdk.Stack();
        table = new dynamodb.Table(stack, 'TestTable', {
            partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        });
        construct = new LambdaConstruct(stack, 'TestLambda', { table });
    });

    it('should create a Lambda function', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Lambda::Function', {
            FunctionName: 'blockbuster-theatre-add-movies-lambda',
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
            FunctionName: 'blockbuster-theatre-add-movies-lambda',
            Environment: {
                Variables: Match.objectLike({
                    TABLE_NAME: Match.anyValue(),
                    MAX_BATCH: '25',
                    TMDB_CONCURRENCY: '5',
                    TMDB_TIMEOUT_MS: '4000',
                    TMDB_RETRIES: '3',
                }),
            },
        });
    });

    it('should set reserved concurrency', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Lambda::Function', {
            ReservedConcurrentExecutions: 5,
        });
    });

    it('should export addMoviesFunction', () => {
        expect(construct.addMoviesFunction).toBeDefined();
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
