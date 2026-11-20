import * as cdk from 'aws-cdk-lib';
import * as authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import { resourceName, type EnvironmentName } from './environment';

interface AuthenticationConstructProps {
    envName?: EnvironmentName;
    prodUserPoolId?: string;
    prodUserPoolClientId?: string;
    prodPostmanClientId?: string;
}

export class AuthenticationConstruct extends Construct {
    public readonly userPool: cognito.IUserPool;
    public readonly userPoolClient: cognito.IUserPoolClient;
    public readonly jwtAuthorizer: authorizers.HttpJwtAuthorizer;
    public readonly loginUrl?: string;

    constructor(scope: Construct, id: string, props: AuthenticationConstructProps = {}) {
        super(scope, id);
        const envName = props.envName ?? 'prod';
        const userPoolId = props.prodUserPoolId
            ?? new cdk.CfnParameter(cdk.Stack.of(this), 'ProdUserPoolId', {
                type: 'String',
                minLength: 1,
                allowedPattern: '.*\\S.*',
                description: 'Existing shared Cognito user pool ID',
            }).valueAsString;
        const userPoolClientId = props.prodUserPoolClientId
            ?? new cdk.CfnParameter(cdk.Stack.of(this), 'ProdUserPoolClientId', {
                type: 'String',
                minLength: 1,
                allowedPattern: '.*\\S.*',
                description: 'Existing shared Cognito frontend client ID',
            }).valueAsString;
        const postmanClientId = props.prodPostmanClientId
            ?? new cdk.CfnParameter(cdk.Stack.of(this), 'ProdPostmanClientId', {
                type: 'String',
                minLength: 1,
                allowedPattern: '.*\\S.*',
                description: 'Existing shared Cognito Postman client ID',
            }).valueAsString;

        this.userPool = cognito.UserPool.fromUserPoolId(this, 'ImportedProdUserPool', userPoolId);
        this.userPoolClient = cognito.UserPoolClient.fromUserPoolClientId(
            this, 'ImportedProdUserPoolClient', userPoolClientId
        );
        this.jwtAuthorizer = new authorizers.HttpJwtAuthorizer(
            resourceName('CognitoJwtAuthorizer', envName),
            `https://cognito-idp.${cdk.Stack.of(this).region}.amazonaws.com/${userPoolId}`,
            { jwtAudience: [userPoolClientId, postmanClientId] }
        );
    }
}
