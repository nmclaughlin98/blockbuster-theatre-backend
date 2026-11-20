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
            TableName: 'blockbuster-theatre-movies-table-PROD',
            BillingMode: 'PAY_PER_REQUEST',
        });
    });

    it('uses the explicitly named PascalCase production movie logical ID', () => {
        const resources = Template.fromStack(stack).toJSON().Resources;
        expect(resources.BlockbusterTheatreMovieCataloguePROD.Properties.TableName)
            .toBe('blockbuster-theatre-movies-table-PROD');
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

    it('should store TMDB list collections without a hierarchy index', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::DynamoDB::Table', {
            TableName: 'blockbuster-theatre-collections-table-PROD',
            KeySchema: [{ AttributeName: 'collectionId', KeyType: 'HASH' }],
            BillingMode: 'PAY_PER_REQUEST',
        });

    });

    it('indexes guest email on both booking tables', () => {
        const template = Template.fromStack(stack);
        for (const TableName of ['blockbuster-theatre-legacy-bookings-table-PROD', 'blockbuster-theatre-bookings-table-PROD']) {
            template.hasResourceProperties('AWS::DynamoDB::Table', {
                TableName,
                GlobalSecondaryIndexes: Match.arrayWith([Match.objectLike({
                    IndexName: 'CustomerEmailBookings',
                    KeySchema: [{ AttributeName: 'customerEmail', KeyType: 'HASH' }],
                    Projection: { ProjectionType: 'ALL' },
                })]),
            });
        }
    });

    it('indexes guest email and date for upcoming booking lookups', () => {
        const template = Template.fromStack(stack);
        for (const TableName of ['blockbuster-theatre-legacy-bookings-table-PROD', 'blockbuster-theatre-bookings-table-PROD']) {
            template.hasResourceProperties('AWS::DynamoDB::Table', {
                TableName,
                GlobalSecondaryIndexes: Match.arrayWith([Match.objectLike({
                    IndexName: 'CustomerEmailUpcomingBookings',
                    KeySchema: [
                        { AttributeName: 'customerEmail', KeyType: 'HASH' },
                        { AttributeName: 'date', KeyType: 'RANGE' },
                    ],
                    Projection: { ProjectionType: 'ALL' },
                })]),
            });
        }
    });

    it('indexes showtime registry records by date without changing the table key', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::DynamoDB::Table', {
            TableName: 'blockbuster-theatre-showtimes-table-PROD',
            KeySchema: [{ AttributeName: 'registryKey', KeyType: 'HASH' }],
            GlobalSecondaryIndexes: Match.arrayWith([Match.objectLike({
                IndexName: 'ShowtimesByDate',
                KeySchema: [
                    { AttributeName: 'GSI1PK', KeyType: 'HASH' },
                    { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
                ],
                Projection: { ProjectionType: 'ALL' },
            })]),
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

    it('should index movies by their numeric rating for top picks', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::DynamoDB::Table', {
            TableName: 'blockbuster-theatre-movies-table-PROD',
            GlobalSecondaryIndexes: Match.arrayWith([
                {
                    IndexName: 'GSI2',
                    KeySchema: [
                        { AttributeName: 'GSI1PK', KeyType: 'HASH' },
                        { AttributeName: 'score', KeyType: 'RANGE' },
                    ],
                    Projection: { ProjectionType: 'ALL' },
                },
            ]),
            AttributeDefinitions: Match.arrayWith([
                { AttributeName: 'score', AttributeType: 'N' },
            ]),
        });
    });

    it('should export table property', () => {
        expect(construct.movieCatalogueTable).toBeDefined();
        expect(construct.movieCatalogueTable).toHaveProperty('tableName');
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
                TableName: 'blockbuster-theatre-collections-table-PROD',
            }),
            DeletionPolicy: 'Retain',
            UpdateReplacePolicy: 'Retain',
        }));
    });
});
