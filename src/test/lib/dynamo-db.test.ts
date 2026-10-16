import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Match } from 'aws-cdk-lib/assertions';
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
            TableName: 'blockbuster-theatre-movie-catalogue',
            BillingMode: 'PAY_PER_REQUEST',
        });
    });

    it('should have correct billing mode', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::DynamoDB::Table', {
            BillingMode: 'PAY_PER_REQUEST',
        });
    });

    it('should use tmdbId and slug as the composite primary key', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::DynamoDB::Table', {
            KeySchema: [
                { AttributeName: 'tmdbId', KeyType: 'HASH' },
                { AttributeName: 'slug', KeyType: 'RANGE' },
            ],
        });
    });

    it('should index movies by collection and collection children by parent', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::DynamoDB::Table', {
            TableName: 'blockbuster-theatre-movie-catalogue',
            GlobalSecondaryIndexes: Match.arrayWith([
                Match.objectLike({
                    IndexName: 'GSI2',
                    KeySchema: [
                        { AttributeName: 'GSI2PK', KeyType: 'HASH' },
                        { AttributeName: 'GSI2SK', KeyType: 'RANGE' },
                    ],
                }),
            ]),
        });
        template.hasResourceProperties('AWS::DynamoDB::Table', {
            TableName: 'blockbuster-theatre-movie-collections',
            KeySchema: [{ AttributeName: 'collectionId', KeyType: 'HASH' }],
            GlobalSecondaryIndexes: Match.arrayWith([
                Match.objectLike({
                    IndexName: 'GSI1',
                    KeySchema: [
                        { AttributeName: 'GSI1PK', KeyType: 'HASH' },
                        { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
                    ],
                }),
            ]),
            BillingMode: 'PAY_PER_REQUEST',
        });
    });

    it('should have string type for id attribute', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::DynamoDB::Table', {
            AttributeDefinitions: Match.arrayWith([
                { AttributeName: 'tmdbId', AttributeType: 'S' },
                { AttributeName: 'slug', AttributeType: 'S' },
            ]),
        });
    });

    it('should export table property', () => {
        expect(construct.table).toBeDefined();
        expect(construct.table).toHaveProperty('tableName');
    });

    it('should retain the movie table when the stack is removed or replaced', () => {
        const template = Template.fromStack(stack);
        template.hasResource('AWS::DynamoDB::Table', Match.objectLike({
            DeletionPolicy: 'Retain',
            UpdateReplacePolicy: 'Retain',
        }));
    });

    it('should retain the collection table when the stack is removed or replaced', () => {
        const template = Template.fromStack(stack);
        template.hasResource('AWS::DynamoDB::Table', Match.objectLike({
            Properties: Match.objectLike({
                TableName: 'blockbuster-theatre-movie-collections',
            }),
            DeletionPolicy: 'Retain',
            UpdateReplacePolicy: 'Retain',
        }));
    });
});
