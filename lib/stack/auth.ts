import * as cdk from 'aws-cdk-lib';
import * as authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as path from 'path';
import { lambdaSettings } from './lambda';

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

        const preTokenFunction = new lambdaNodejs.NodejsFunction(this, 'PreTokenGenerationHandler', {
            functionName: 'blockbuster-theatre-pre-token-generation-handler',
            runtime: lambdaSettings.runtime,
            entry: path.join(__dirname, '../../src/main/lambda/handlers/PreTokenGeneration/pre-token-generation-handler.ts'),
            handler: 'handler',
            memorySize: lambdaSettings.default.memorySize,
            timeout: cdk.Duration.seconds(5),
            logRetention: logs.RetentionDays.ONE_WEEK,
        });
        this.userPool.addTrigger(
            cognito.UserPoolOperation.PRE_TOKEN_GENERATION_CONFIG,
            preTokenFunction,
            cognito.LambdaVersion.V1_0
        );

        // A separate policy avoids making the function depend on the user pool it triggers.
        new iam.Policy(this, 'PreTokenGenerationUserReadPolicy', {
            roles: [preTokenFunction.role!],
            statements: [new iam.PolicyStatement({
                actions: ['cognito-idp:AdminGetUser'],
                resources: [this.userPool.userPoolArn],
            })],
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
            authFlows: { userSrp: true, adminUserPassword: true },
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
