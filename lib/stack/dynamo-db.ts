import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import { resourceName, type EnvironmentName } from './environment';

export class DatabaseConstruct extends Construct {
    public readonly movieCatalogueTable: dynamodb.Table;
    public readonly pricingTable: dynamodb.Table;
    public readonly offersTable: dynamodb.Table;
    public readonly collectionsTable: dynamodb.Table;
    public readonly bookingsTable: dynamodb.Table;
    public readonly showtimeRegistryTable: dynamodb.Table;
    public readonly guestConversionTokensTable: dynamodb.Table;

    constructor(scope: Construct, id: string, envName: EnvironmentName = 'prod') {
        super(scope, id);
        const tableName = (name: string): string => resourceName(name, envName);
        const removalPolicy = envName === 'dev'
            ? cdk.RemovalPolicy.DESTROY
            : cdk.RemovalPolicy.RETAIN;

        this.movieCatalogueTable = new dynamodb.Table(this, 'BlockbusterTheatreMovies', {
            tableName: tableName('blockbuster-theatre-movies-table'),
            partitionKey: { name: 'movieId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,

            removalPolicy,
        });

        this.pricingTable = new dynamodb.Table(this, 'BlockbusterTheatrePricing', {
            tableName: tableName('blockbuster-theatre-pricing-table'),
            partitionKey: { name: 'pricingId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy,
        });

        this.offersTable = new dynamodb.Table(this, 'BlockbusterTheatreOffers', {
            tableName: tableName('blockbuster-theatre-offers-table'),
            partitionKey: { name: 'offerId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy,
        });

        this.movieCatalogueTable.addGlobalSecondaryIndex({
            indexName: 'MoviesByReleaseDate',
            partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL,
        });

        this.movieCatalogueTable.addGlobalSecondaryIndex({
            indexName: 'MoviesByScore',
            partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'score', type: dynamodb.AttributeType.NUMBER },
            projectionType: dynamodb.ProjectionType.ALL,
        });

        this.collectionsTable = new dynamodb.Table(this, 'BlockbusterTheatreMovieCollections', {
            tableName: tableName('blockbuster-theatre-collections-table'),
            partitionKey: { name: 'collectionId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy,
        });

        this.bookingsTable = new dynamodb.Table(this, 'BlockbusterTheatreBookings', {
            tableName: tableName('blockbuster-theatre-bookings-table'),
            partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy,
        });
        this.bookingsTable.addGlobalSecondaryIndex({
            indexName: 'UserBookings',
            partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'screeningKey', type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL,
        });
        this.bookingsTable.addGlobalSecondaryIndex({
            indexName: 'CustomerEmailBookings',
            partitionKey: { name: 'customerEmail', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'screeningKey', type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL,
        });
        this.bookingsTable.addGlobalSecondaryIndex({
            indexName: 'ShowtimeBookings',
            partitionKey: { name: 'showtimeId', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'screeningKey', type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL,
        });

        this.showtimeRegistryTable = new dynamodb.Table(this, 'BlockbusterTheatreShowtimeRegistry', {
            tableName: tableName('blockbuster-theatre-showtimes-table'),
            partitionKey: { name: 'registryKey', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy,
        });
        this.showtimeRegistryTable.addGlobalSecondaryIndex({
            indexName: 'ShowtimesByDate',
            partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL,
        });

        this.guestConversionTokensTable = new dynamodb.Table(
            this,
            'BlockbusterTheatreGuestConversionTokens',
            {
                tableName: tableName('blockbuster-theatre-guest-conversion-tokens-table'),
                partitionKey: { name: 'tokenHash', type: dynamodb.AttributeType.STRING },
                billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
                timeToLiveAttribute: 'expiresAt',
                removalPolicy,
            }
        );

        for (const [table, name] of [
            [this.movieCatalogueTable, 'MovieCatalogue'],
            [this.pricingTable, 'Pricing'],
            [this.offersTable, 'Offers'],
            [this.collectionsTable, 'Collections'],
            [this.bookingsTable, 'Bookings'],
            [this.showtimeRegistryTable, 'Showtimes'],
            [this.guestConversionTokensTable, 'GuestConversionTokens'],
        ] as const) {
            const resource = table.node.defaultChild;
            if (!(resource instanceof dynamodb.CfnTable)) {
                throw new Error(`Missing DynamoDB resource for ${name}.`);
            }
            resource.overrideLogicalId(`BlockbusterTheatre${name}${envName.toUpperCase()}`);
        }
    }
}