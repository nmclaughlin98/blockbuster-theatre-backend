import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import { resourceName, AuthSsmHelper } from '../shared';
import { createCognitoResources } from './cognito-construct';
import { createBookingsResourceServer } from './resource-servers-construct';

export interface BlockbusterTheatreAuthStackProps extends cdk.StackProps {
    readonly domainPrefix?: string;
    readonly resourceServerIdentifier?: string;
    readonly removalPolicy?: cdk.RemovalPolicy;
}

export class CognitoStack extends cdk.Stack {
    public readonly userPool: cognito.UserPool;
    public readonly userPoolDomain: cognito.UserPoolDomain;
    public readonly backendClient: cognito.UserPoolClient;
    public readonly postmanClient: cognito.UserPoolClient;
    public readonly alexaClient: cognito.UserPoolClient;
    public readonly resourceServer: cognito.UserPoolResourceServer;
    public readonly readBookingsScope: cognito.ResourceServerScope;
    public readonly devResourceServer: cognito.UserPoolResourceServer;
    public readonly devReadBookingsScope: cognito.ResourceServerScope;
    public readonly loginUrl?: string;

    constructor(scope: Construct, id: string, props: BlockbusterTheatreAuthStackProps = {}) {
        super(scope, id, {
            ...props,
            terminationProtection: props.terminationProtection ?? true,
        });

        cdk.Tags.of(this).add('Project', 'blockbuster-theatre');
        cdk.Tags.of(this).add('StackType', 'auth');

        const envName = 'prod';
        const removalPolicy = props.removalPolicy ?? cdk.RemovalPolicy.RETAIN;

        ({ userPool: this.userPool, userPoolDomain: this.userPoolDomain } = createCognitoResources(
            this,
            removalPolicy,
            props.domainPrefix ?? 'blockbuster-theatre'
        ));
        ({ resourceServer: this.resourceServer, readBookingsScope: this.readBookingsScope } =
            createBookingsResourceServer(
                this.userPool,
                props.resourceServerIdentifier ?? 'https://api.blockbuster-theatre.nml-applications.com'
            ));
        ({ resourceServer: this.devResourceServer, readBookingsScope: this.devReadBookingsScope } =
            createBookingsResourceServer(
                this.userPool,
                'https://api-dev.blockbuster-theatre.nml-applications.com',
                'dev'
            ));

        // 5. Postman App Client (OAuth Authorization Code Grant)
        this.postmanClient = this.userPool.addClient('PostmanAppClient', {
            userPoolClientName: resourceName('postman-test-client', envName),
            generateSecret: false,
            oAuth: {
                flows: {
                    authorizationCodeGrant: true,
                },
                scopes: [
                    cognito.OAuthScope.OPENID,
                    cognito.OAuthScope.EMAIL,
                    cognito.OAuthScope.PROFILE,
                ],
                callbackUrls: [
                    'https://oauth.pstmn.io/v1/callback',
                    'https://oauth.pstmn.io/v1/browser-callback',
                ],
                logoutUrls: ['https://oauth.pstmn.io/v1/callback'],
            },
        });

        new cognito.CfnManagedLoginBranding(this, 'PostmanLoginBranding', {
            userPoolId: this.userPool.userPoolId,
            clientId: this.postmanClient.userPoolClientId,
            settings: {
                categories: {
                    global: {
                        colorSchemeMode: 'DARK',
                    },
                },
            },
        });

        this.loginUrl = `${this.userPoolDomain.signInUrl(this.postmanClient, {
            redirectUri: 'https://oauth.pstmn.io/v1/callback',
        })}&scope=openid%20email%20profile`;

        // 6. Backend App Client (SRP Auth Flow)
        this.backendClient = this.userPool.addClient('BackendClient', {
            userPoolClientName: resourceName('blockbuster-theatre-backend', envName),
            generateSecret: false,
            authFlows: { userSrp: true, adminUserPassword: true },
            disableOAuth: true,
            preventUserExistenceErrors: true,
            enableTokenRevocation: true,
            accessTokenValidity: cdk.Duration.minutes(60),
            idTokenValidity: cdk.Duration.minutes(60),
            refreshTokenValidity: cdk.Duration.days(30),
            refreshTokenRotationGracePeriod: cdk.Duration.seconds(30),
        });

        // 7. Alexa App Client (OAuth Authorization Code Grant with custom 'bookings.read' scope)
        this.alexaClient = this.userPool.addClient('AlexaAppClient', {
            userPoolClientName: resourceName('alexa-skill-client', envName),
            generateSecret: false,
            oAuth: {
                flows: {
                    authorizationCodeGrant: true,
                },
                scopes: [
                    cognito.OAuthScope.OPENID,
                    cognito.OAuthScope.EMAIL,
                    cognito.OAuthScope.PROFILE,
                    cognito.OAuthScope.resourceServer(this.resourceServer, this.readBookingsScope),
                    cognito.OAuthScope.resourceServer(this.devResourceServer, this.devReadBookingsScope),
                ],
                callbackUrls: [
                    'https://pitangui.amazon.com/api/skill/link',
                    'https://layla.amazon.com/api/skill/link',
                    'https://alexa.amazon.co.jp/api/skill/link',
                ],
                logoutUrls: ['https://pitangui.amazon.com/api/skill/link'],
            },
        });

        // 8. SSM Parameter Store exports under consistent namespace
        AuthSsmHelper.writeAuthParameters(this, {
            userPoolId: this.userPool.userPoolId,
            userPoolArn: this.userPool.userPoolArn,
            backendClientId: this.backendClient.userPoolClientId,
            postmanClientId: this.postmanClient.userPoolClientId,
            alexaClientId: this.alexaClient.userPoolClientId,
        });

        // Stack CfnOutputs
        new cdk.CfnOutput(this, 'UserPoolId', {
            value: this.userPool.userPoolId,
            description: 'Cognito user pool ID',
        });
        new cdk.CfnOutput(this, 'UserPoolArn', {
            value: this.userPool.userPoolArn,
            description: 'Cognito user pool ARN',
        });
        new cdk.CfnOutput(this, 'BackendClientId', {
            value: this.backendClient.userPoolClientId,
            description: 'Cognito public backend app client ID (SRP)',
        });
        new cdk.CfnOutput(this, 'PostmanClientId', {
            value: this.postmanClient.userPoolClientId,
            description: 'Cognito Postman app client ID (OAuth)',
        });
        new cdk.CfnOutput(this, 'AlexaClientId', {
            value: this.alexaClient.userPoolClientId,
            description: 'Cognito Alexa app client ID (OAuth)',
        });
        if (this.loginUrl) {
            new cdk.CfnOutput(this, 'CognitoLoginUrl', {
                value: this.loginUrl,
                description: 'Cognito managed login URL for browser authorization',
            });
        }
    }
}
