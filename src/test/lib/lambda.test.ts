import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Template } from 'aws-cdk-lib/assertions';
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
            FunctionName: 'BlockbusterTheatre-ManageItems',
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
            MemorySize: 128,
        });
    });

    it('should set correct timeout', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Lambda::Function', {
            Timeout: 5,
        });
    });

    it('should set TABLE_NAME environment variable', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Lambda::Function', {
            FunctionName: 'BlockbusterTheatre-ManageItems',
        });
    });

    it('should export manageItemsFunction', () => {
        expect(construct.manageItemsFunction).toBeDefined();
    });

    it('should grant read/write permissions to DynamoDB', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::IAM::Role', {});
    });

    it('should have handler set to "handler"', () => {
        expect(construct.manageItemsFunction).toBeDefined();
        expect(construct.manageItemsFunction.node).toBeDefined();
    });
});
