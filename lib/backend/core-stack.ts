import * as cdk from 'aws-cdk-lib';
import * as authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ses from 'aws-cdk-lib/aws-ses';
import { Construct } from 'constructs';
import { DatabaseConstruct } from './database-construct';
import { ApiGatewayConstruct } from './api-gateway-construct';
import { LambdaConstruct } from './lambdas-construct';
import { AuthSsmHelper, type AuthParameters, type EnvironmentName, resourceName } from '../shared';

export interface BackendStackProps extends cdk.StackProps {
    readonly envName?: EnvironmentName;
    readonly authParameters?: Partial<AuthParameters>;
    readonly prodUserPoolId?: string;
    readonly prodUserPoolClientId?: string;
    readonly prodPostmanClientId?: string;
    readonly prodAlexaClientId?: string;
}

export class BackendStack extends cdk.Stack {
    public readonly database: DatabaseConstruct;
    public readonly lambdaServices: LambdaConstruct;
    public readonly apiGateway: ApiGatewayConstruct;
    public readonly jwtAuthorizer: authorizers.HttpJwtAuthorizer;
    public readonly userPool: cognito.IUserPool;
    public readonly userPoolClient: cognito.IUserPoolClient;
    public readonly authParameters: AuthParameters;

    constructor(scope: Construct, id: string, props: BackendStackProps = {}) {
        const {
            envName = 'prod',
            authParameters: explicitAuthParams,
            prodUserPoolId,
            prodUserPoolClientId,
            prodPostmanClientId,
            prodAlexaClientId,
            ...stackProps
        } = props;

        super(scope, id, stackProps);

        cdk.Tags.of(this).add('Project', 'blockbuster-theatre');
        cdk.Tags.of(this).add('Environment', envName);

        // 1. Resolve Cognito authentication identifiers from SSM Parameter Store (no cross-stack CfnOutput locks)
        this.authParameters = AuthSsmHelper.readAuthParameters(this, {
            userPoolId: explicitAuthParams?.userPoolId ?? prodUserPoolId,
            userPoolArn: explicitAuthParams?.userPoolArn,
            backendClientId: explicitAuthParams?.backendClientId ?? prodUserPoolClientId,
            postmanClientId: explicitAuthParams?.postmanClientId ?? prodPostmanClientId,
            alexaClientId: explicitAuthParams?.alexaClientId ?? prodAlexaClientId,
        });

        this.userPool = cognito.UserPool.fromUserPoolId(
            this,
            'ImportedUserPool',
            this.authParameters.userPoolId,
        );

        this.userPoolClient = cognito.UserPoolClient.fromUserPoolClientId(
            this,
            'ImportedBackendClient',
            this.authParameters.backendClientId,
        );

        // 2. HTTP JWT Authorizer accepting SRP backend client and OAuth clients (Postman, Alexa)
        this.jwtAuthorizer = new authorizers.HttpJwtAuthorizer(
            resourceName('blockbuster-theatre-CognitoJwtAuthorizer', envName),
            `https://cognito-idp.${this.region}.amazonaws.com/${this.authParameters.userPoolId}`,
            {
                jwtAudience: [
                    this.authParameters.backendClientId,
                    this.authParameters.postmanClientId,
                    this.authParameters.alexaClientId,
                ],
            },
        );

        // 3. DynamoDB Tables
        this.database = new DatabaseConstruct(this, 'MoviesDatabase', envName);

        // 4. SES Booking Email Identity
        const bookingEmailIdentity =
            envName === 'prod'
                ? new ses.EmailIdentity(this, 'BookingEmailIdentity', {
                      identity: ses.Identity.email('niallmclaughlin1998@gmail.com'),
                  })
                : ses.EmailIdentity.fromEmailIdentityName(
                      this,
                      'ImportedBookingEmailIdentity',
                      'niallmclaughlin1998@gmail.com',
                  );

        // 5. Lambda Functions & Table Permissions
        this.lambdaServices = new LambdaConstruct(this, 'BlockbusterTheatreMoviesLambda', {
            table: this.database.movieCatalogueTable,
            pricingTable: this.database.pricingTable,
            offersTable: this.database.offersTable,
            collectionsTable: this.database.collectionsTable,
            bookingsTable: this.database.bookingsTable,
            legacyBookingsTable: this.database.legacyBookingsTable,
            showtimeRegistryTable: this.database.showtimeRegistryTable,
            bookingReferencesTable: this.database.bookingReferencesTable,
            guestConversionTokensTable: this.database.guestConversionTokensTable,
            userPool: this.userPool,
            userPoolClient: this.userPoolClient,
            bookingEmailIdentity,
            envName,
        });

        // 6. API Gateway HTTP API
        this.apiGateway = new ApiGatewayConstruct(this, 'ApiGateway', {
            addMoviesFunction: this.lambdaServices.addMoviesFunction,
            updateMoviesFunction: this.lambdaServices.updateMoviesFunction,
            listMoviesFunction: this.lambdaServices.listMoviesFunction,
            listFeaturedMoviesFunction: this.lambdaServices.listFeaturedMoviesFunction,
            getMovieFunction: this.lambdaServices.getMovieFunction,
            exportMoviesFunction: this.lambdaServices.exportMoviesFunction,
            listTmdbIdsFunction: this.lambdaServices.listTmdbIdsFunction,
            listFilmSelectionsFunction: this.lambdaServices.listFilmSelectionsFunction,
            getTicketPricingFunction: this.lambdaServices.getTicketPricingFunction,
            validateCheckoutFunction: this.lambdaServices.validateCheckoutFunction,
            sendBookingConfirmationFunction: this.lambdaServices.sendBookingConfirmationFunction,
            upsertBookingOffersFunction: this.lambdaServices.upsertBookingOffersFunction,
            upsertTicketPricingFunction: this.lambdaServices.upsertTicketPricingFunction,
            listMovieCollectionsFunction: this.lambdaServices.listMovieCollectionsFunction,
            getMovieCollectionFunction: this.lambdaServices.getMovieCollectionFunction,
            refreshMovieCollectionFunction: this.lambdaServices.refreshMovieCollectionFunction,
            listBookingsFunction: this.lambdaServices.listBookingsFunction,
            createBookingFunction: this.lambdaServices.createBookingFunction,
            rescheduleBookingFunction: this.lambdaServices.rescheduleBookingFunction,
            manageShowtimesFunction: this.lambdaServices.manageShowtimesFunction,
            guestBookedSeatsFunction: this.lambdaServices.guestBookedSeatsFunction,
            guestBookingFunction: this.lambdaServices.guestBookingFunction,
            guestConversionFunction: this.lambdaServices.guestConversionFunction,
            downloadTicketFunction: this.lambdaServices.downloadTicketFunction,
            jwtAuthorizer: this.jwtAuthorizer,
            envName,
        });

        // 7. Output backend endpoint for client apps
        new cdk.CfnOutput(this, 'ApiEndpoint', {
            value: this.apiGateway.httpApi.url!,
            description: 'Base HTTP endpoint for WinForms, WinUI 3, SwiftUI, and Web SPA',
        });

        new cdk.CfnOutput(this, 'UserPoolId', {
            value: this.authParameters.userPoolId,
            description: 'Cognito user pool ID for frontend authentication',
        });

        new cdk.CfnOutput(this, 'UserPoolClientId', {
            value: this.authParameters.backendClientId,
            description: 'Cognito public app client ID for frontend authentication',
        });

        new cdk.CfnOutput(this, 'UserPoolIssuer', {
            value: `https://cognito-idp.${this.region}.amazonaws.com/${this.authParameters.userPoolId}`,
            description: 'JWT issuer configured on the API Gateway authorizer',
        });
    }
}
