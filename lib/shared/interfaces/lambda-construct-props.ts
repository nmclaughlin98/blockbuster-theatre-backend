import type * as cognito from 'aws-cdk-lib/aws-cognito';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import type * as ses from 'aws-cdk-lib/aws-ses';
import type { EnvironmentName } from '../environment';
import type { MovieImportLambdaConfig } from './movie-import-lambda-config';

export interface LambdaConstructProps {
    table: dynamodb.Table;
    pricingTable: dynamodb.Table;
    offersTable: dynamodb.Table;
    collectionsTable: dynamodb.Table;
    bookingsTable: dynamodb.Table;
    legacyBookingsTable: dynamodb.Table;
    showtimeRegistryTable: dynamodb.Table;
    bookingReferencesTable: dynamodb.Table;
    guestConversionTokensTable: dynamodb.Table;
    userPool: cognito.IUserPool;
    userPoolClient: cognito.IUserPoolClient;
    bookingEmailIdentity: ses.IEmailIdentity;
    lambdaConfig?: MovieImportLambdaConfig;
    envName?: EnvironmentName;
}
