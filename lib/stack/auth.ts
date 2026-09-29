import * as cdk from 'aws-cdk-lib';
import * as authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

export class AuthenticationConstruct extends Construct {
    public readonly userPool: cognito.UserPool;
    public readonly userPoolClient: cognito.UserPoolClient;
    public readonly jwtAuthorizer: authorizers.HttpJwtAuthorizer;
    public readonly loginUrl: string;

    /**
     * Creates the Cognito user pool, public frontend client, and API Gateway JWT authorizer.
     * Self-service registration is disabled; users must be provisioned by an administrator.
     * @param scope Parent CDK construct.
     * @param id Construct identifier.
     */
    constructor(scope: Construct, id: string) {
        super(scope, id);

        this.userPool = new cognito.UserPool(this, 'MovieUsers', {
            userPoolName: 'blockbuster-theatre-users',
            selfSignUpEnabled: false,
            signInAliases: { email: true },
            autoVerify: { email: true },
            accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
            passwordPolicy: {
                minLength: 12,
                requireDigits: true,
                requireLowercase: true,
                requireSymbols: true,
                requireUppercase: true,
            },
        });

        const userPoolDomain = this.userPool.addDomain('CognitoDomain', {
            cognitoDomain: {
                domainPrefix: 'blockbuster-theatre',
            },
            managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
        });

        const postmanClient = this.userPool.addClient('PostmanAppClient', {
            userPoolClientName: 'postman-test-client',
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
            clientId: postmanClient.userPoolClientId,
            settings: {
                categories: {
                    global: {
                        colorSchemeMode: 'DARK',
                    },
                },
            },
        });

        this.loginUrl = `${userPoolDomain.signInUrl(postmanClient, {
            redirectUri: 'https://oauth.pstmn.io/v1/callback',
        })}&scope=openid%20email%20profile`;

        this.userPoolClient = this.userPool.addClient('BackendClient', {
            userPoolClientName: 'blockbuster-theatre-backend',
            generateSecret: false,
            authFlows: { userSrp: true },
            preventUserExistenceErrors: true,
            enableTokenRevocation: true,
            accessTokenValidity: cdk.Duration.minutes(60),
            idTokenValidity: cdk.Duration.minutes(60),
            refreshTokenValidity: cdk.Duration.days(30),
            refreshTokenRotationGracePeriod: cdk.Duration.seconds(30),
        });

        this.jwtAuthorizer = new authorizers.HttpJwtAuthorizer(
            'CognitoJwtAuthorizer',
            `https://cognito-idp.${cdk.Stack.of(this).region}.amazonaws.com/${this.userPool.userPoolId}`,
            {
                jwtAudience: [
                    this.userPoolClient.userPoolClientId,
                    postmanClient.userPoolClientId,
                ],
            }
        );
    }
}
