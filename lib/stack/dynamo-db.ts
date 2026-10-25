import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export class DatabaseConstruct extends Construct {
    public readonly table: dynamodb.Table;
    public readonly pricingTable: dynamodb.Table;
    public readonly offersTable: dynamodb.Table;
    public readonly collectionsTable: dynamodb.Table;
    public readonly bookingsTable: dynamodb.Table;
    public readonly legacyBookingsTable: dynamodb.Table;
    public readonly showtimeRegistryTable: dynamodb.Table;
    public readonly bookingReferencesTable: dynamodb.Table;
    public readonly guestConversionTokensTable: dynamodb.Table;

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

        this.table.addGlobalSecondaryIndex({
            indexName: 'GSI2',
            partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'score', type: dynamodb.AttributeType.NUMBER },
            projectionType: dynamodb.ProjectionType.ALL,
        });

        this.collectionsTable = new dynamodb.Table(this, 'BlockbusterTheatreMovieCollections', {
            tableName: 'blockbuster-theatre-movie-collections',
            partitionKey: { name: 'collectionId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
        });

        // Preserve the deployed key schema; the new booking table is separate because DynamoDB keys cannot be altered in place.
        this.legacyBookingsTable = new dynamodb.Table(this, 'BlockbusterTheatreBookings', {
            tableName: 'blockbuster-theatre-bookings',
            partitionKey: { name: 'showingId', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'seatId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
        });

        this.legacyBookingsTable.addGlobalSecondaryIndex({
            indexName: 'UserBookings',
            partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'bookedAt', type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL,
        });

        this.bookingsTable = new dynamodb.Table(this, 'BlockbusterTheatreBookingsByShowtime', {
            tableName: 'blockbuster-theatre-bookings-by-showtime',
            partitionKey: { name: 'showtimeId', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'seatId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
        });
        this.bookingsTable.addGlobalSecondaryIndex({
            indexName: 'UserBookings',
            partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'bookedAt', type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL,
        });

        this.showtimeRegistryTable = new dynamodb.Table(this, 'BlockbusterTheatreShowtimeRegistry', {
            tableName: 'blockbuster-theatre-showtime-registry',
            partitionKey: { name: 'registryKey', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
        });

        this.bookingReferencesTable = new dynamodb.Table(this, 'BlockbusterTheatreBookingReferences', {
            tableName: 'blockbuster-theatre-booking-references',
            partitionKey: { name: 'bookingRef', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
        });

        this.guestConversionTokensTable = new dynamodb.Table(
            this,
            'BlockbusterTheatreGuestConversionTokens',
            {
                tableName: 'blockbuster-theatre-guest-conversion-tokens',
                partitionKey: { name: 'tokenHash', type: dynamodb.AttributeType.STRING },
                billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
                timeToLiveAttribute: 'expiresAt',
                removalPolicy: cdk.RemovalPolicy.RETAIN,
            }
        );
    }
}