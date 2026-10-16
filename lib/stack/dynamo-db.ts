import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export class DatabaseConstruct extends Construct {
    public readonly table: dynamodb.Table;
    public readonly pricingTable: dynamodb.Table;
    public readonly offersTable: dynamodb.Table;

    constructor(scope: Construct, id: string) {
        super(scope, id);

        this.table = new dynamodb.Table(this, 'BlockbusterTheatreMovies', {
            // Use a new physical name so CloudFormation can replace the old key schema safely.
            tableName: 'blockbuster-theatre-movie-catalogue',
            partitionKey: { name: 'tmdbId', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'slug', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,

            removalPolicy: cdk.RemovalPolicy.RETAIN,
        });

        this.pricingTable = new dynamodb.Table(this, 'BlockbusterTheatrePricing', {
            tableName: 'blockbuster-theatre-ticket-pricing',
            partitionKey: { name: 'pricingId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
        });

        this.offersTable = new dynamodb.Table(this, 'BlockbusterTheatreOffers', {
            tableName: 'blockbuster-theatre-booking-offers',
            partitionKey: { name: 'offerId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
        });

        this.table.addGlobalSecondaryIndex({
            indexName: 'GSI1',
            partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL,
        });
    }
}