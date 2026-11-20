import * as cdk from 'aws-cdk-lib';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as path from 'path';
import { Construct } from 'constructs';
import {
    ApiGatewayConstruct,
    AuthenticationConstruct,
    DatabaseConstruct,
    LambdaConstruct,
} from './stack';
import { resourceName, type EnvironmentName } from './stack/environment';

interface BlockbusterTheatreBackendStackProps extends cdk.StackProps {
    envName?: EnvironmentName;
    prodUserPoolId?: string;
    prodUserPoolClientId?: string;
    prodPostmanClientId?: string;
}

export class BlockbusterTheatreBackendStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: BlockbusterTheatreBackendStackProps = {}) {
        const {
            envName = 'prod',
            prodUserPoolId,
            prodUserPoolClientId,
            prodPostmanClientId,
            ...stackProps
        } = props;
        super(scope, id, stackProps);

        cdk.Tags.of(this).add('Project', 'blockbuster-theatre');
        cdk.Tags.of(this).add('Environment', envName);

        // 1. Instantiate DynamoDB
        const database = new DatabaseConstruct(this, 'MoviesDatabase', envName);
        const authentication = new AuthenticationConstruct(this, 'Authentication', {
            envName,
            prodUserPoolId,
            prodUserPoolClientId,
            prodPostmanClientId,
        });
        const bookingEmailIdentity = envName === 'prod'
            ? new ses.EmailIdentity(this, 'BookingEmailIdentity', {
                identity: ses.Identity.email('niallmclaughlin1998@gmail.com'),
            })
            : ses.EmailIdentity.fromEmailIdentityName(
                this,
                'ImportedBookingEmailIdentity',
                'niallmclaughlin1998@gmail.com'
            );

        // 2. Instantiate Lambda & pass DB table
        const lambdaServices = new LambdaConstruct(this, 'BlockbusterTheatreMoviesLambda', {
            table: database.movieCatalogueTable,
            pricingTable: database.pricingTable,
            offersTable: database.offersTable,
            collectionsTable: database.collectionsTable,
            bookingsTable: database.bookingsTable,
            legacyBookingsTable: database.legacyBookingsTable,
            showtimeRegistryTable: database.showtimeRegistryTable,
            bookingReferencesTable: database.bookingReferencesTable,
            guestConversionTokensTable: database.guestConversionTokensTable,
            userPool: authentication.userPool,
            userPoolClient: authentication.userPoolClient,
            bookingEmailIdentity,
            envName,
        });

        const apiDocsFunction = new lambda.Function(this, 'ApiDocsHandler', {
            functionName: resourceName('blockbuster-theatre-api-docs-handler', envName),
            runtime: lambda.Runtime.NODEJS_24_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../build/api-docs', envName)),
            logRetention: logs.RetentionDays.ONE_WEEK,
        });

        // 3. Instantiate API Gateway & pass Lambda handler
        const apiGateway = new ApiGatewayConstruct(this, 'ApiGateway', {
            apiDocsFunction,
            addMoviesFunction: lambdaServices.addMoviesFunction,
            updateMoviesFunction: lambdaServices.updateMoviesFunction,
            listMoviesFunction: lambdaServices.listMoviesFunction,
            listFeaturedMoviesFunction: lambdaServices.listFeaturedMoviesFunction,
            getMovieFunction: lambdaServices.getMovieFunction,
            exportMoviesFunction: lambdaServices.exportMoviesFunction,
            listTmdbIdsFunction: lambdaServices.listTmdbIdsFunction,
            listFilmSelectionsFunction: lambdaServices.listFilmSelectionsFunction,
            getTicketPricingFunction: lambdaServices.getTicketPricingFunction,
            validateCheckoutFunction: lambdaServices.validateCheckoutFunction,
            sendBookingConfirmationFunction: lambdaServices.sendBookingConfirmationFunction,
            upsertBookingOffersFunction: lambdaServices.upsertBookingOffersFunction,
            upsertTicketPricingFunction: lambdaServices.upsertTicketPricingFunction,
            listMovieCollectionsFunction: lambdaServices.listMovieCollectionsFunction,
            getMovieCollectionFunction: lambdaServices.getMovieCollectionFunction,
            refreshMovieCollectionFunction: lambdaServices.refreshMovieCollectionFunction,
            listBookingsFunction: lambdaServices.listBookingsFunction,
            createBookingFunction: lambdaServices.createBookingFunction,
            rescheduleBookingFunction: lambdaServices.rescheduleBookingFunction,
            manageShowtimesFunction: lambdaServices.manageShowtimesFunction,
            guestBookedSeatsFunction: lambdaServices.guestBookedSeatsFunction,
            guestBookingFunction: lambdaServices.guestBookingFunction,
            guestConversionFunction: lambdaServices.guestConversionFunction,
            downloadTicketFunction: lambdaServices.downloadTicketFunction,
            jwtAuthorizer: authentication.jwtAuthorizer,
            envName,
        });

        // Output backend endpoint for client apps
        new cdk.CfnOutput(this, 'ApiEndpoint', {
            value: apiGateway.httpApi.url!,
            description: 'Base HTTP endpoint for WinForms, WinUI 3, SwiftUI, and Web SPA',
        });
        new cdk.CfnOutput(this, 'ApiDocumentationUrl', {
            value: `https://api${envName === 'dev' ? '-dev' : ''}.blockbuster-theatre.nml-applications.com/api-docs`,
            description: 'API reference and downloadable OpenAPI specification',
        });
        new cdk.CfnOutput(this, 'UserPoolId', {
            value: authentication.userPool.userPoolId,
            description: 'Cognito user pool ID for frontend authentication',
        });
        new cdk.CfnOutput(this, 'UserPoolClientId', {
            value: authentication.userPoolClient.userPoolClientId,
            description: 'Cognito public app client ID for frontend authentication',
        });
        new cdk.CfnOutput(this, 'UserPoolIssuer', {
            value: `https://cognito-idp.${this.region}.amazonaws.com/${authentication.userPool.userPoolId}`,
            description: 'JWT issuer configured on the API Gateway authorizer',
        });
        if (authentication.loginUrl) {
            new cdk.CfnOutput(this, 'CognitoLoginUrl', {
                value: authentication.loginUrl,
                description: 'Dark-mode Cognito managed login URL for browser authorization',
            });
        }
    }
}