import * as cdk from 'aws-cdk-lib';
import * as authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

export class AuthenticationConstruct extends Construct {
    public readonly userPool: cognito.UserPool;
    public readonly userPoolClient: cognito.UserPoolClient;
    public readonly jwtAuthorizer: authorizers.HttpJwtAuthorizer;

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

        this.userPoolClient = this.userPool.addClient('FrontendClient', {
            userPoolClientName: 'blockbuster-theatre-frontend',
            generateSecret: false,
            authFlows: { userSrp: true },
            preventUserExistenceErrors: true,
            enableTokenRevocation: true,
            accessTokenValidity: cdk.Duration.minutes(15),
            idTokenValidity: cdk.Duration.minutes(15),
            refreshTokenValidity: cdk.Duration.days(30),
            refreshTokenRotationGracePeriod: cdk.Duration.seconds(30),
        });

        this.jwtAuthorizer = new authorizers.HttpJwtAuthorizer(
            'CognitoJwtAuthorizer',
            `https://cognito-idp.${cdk.Stack.of(this).region}.amazonaws.com/${this.userPool.userPoolId}`,
            { jwtAudience: [this.userPoolClient.userPoolClientId] }
        );
    }
}
