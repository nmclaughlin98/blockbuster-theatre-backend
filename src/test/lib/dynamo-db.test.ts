import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { DatabaseConstruct } from '../../../lib/stack';

describe('DatabaseConstruct', () => {
    let stack: cdk.Stack;
    let construct: DatabaseConstruct;

    beforeEach(() => {
        stack = new cdk.Stack();
        construct = new DatabaseConstruct(stack, 'TestDatabase');
    });

    it('should create a DynamoDB table', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::DynamoDB::Table', {
            TableName: 'BlockbusterTheatre',
        });
    });

    it('should have correct billing mode', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::DynamoDB::Table', {
            BillingMode: 'PAY_PER_REQUEST',
        });
    });

    it('should have id as partition key', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::DynamoDB::Table', {
            KeySchema: [
                {
                    AttributeName: 'id',
                    KeyType: 'HASH',
                },
            ],
        });
    });

    it('should have string type for id attribute', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::DynamoDB::Table', {
            AttributeDefinitions: [
                {
                    AttributeName: 'id',
                    AttributeType: 'S',
                },
            ],
        });
    });

    it('should export table property', () => {
        expect(construct.table).toBeDefined();
        expect(construct.table).toHaveProperty('tableName');
    });

    it('should have DESTROY removal policy', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::DynamoDB::Table', {
            TableName: 'BlockbusterTheatre',
        });
    });
});
