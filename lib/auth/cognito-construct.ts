import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { lambdaSettings } from '../backend/lambdas-construct';

export function createCognitoResources(
    scope: Construct,
    removalPolicy: cdk.RemovalPolicy,
    domainPrefix: string,
): { userPool: cognito.UserPool; userPoolDomain: cognito.UserPoolDomain } {
    const userPool = new cognito.UserPool(scope, 'BlockbusterTheatreCognitoUsers', {
        userPoolName: 'blockbuster-theatre-users',
        selfSignUpEnabled: true,
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
        removalPolicy,
    });

    const preTokenFunction = new lambdaNodejs.NodejsFunction(scope, 'PreTokenGenerationHandler', {
        functionName: 'blockbuster-theatre-pre-token-generation-handler',
        runtime: lambdaSettings.runtime,
        entry: path.join(
            __dirname,
            '../../src/main/lambda/handlers/PreTokenGeneration/pre-token-generation-handler.ts',
        ),
        handler: 'handler',
        memorySize: lambdaSettings.default.memorySize,
        timeout: cdk.Duration.seconds(5),
        logRetention: logs.RetentionDays.ONE_WEEK,
    });

    userPool.addTrigger(
        cognito.UserPoolOperation.PRE_TOKEN_GENERATION_CONFIG,
        preTokenFunction,
        cognito.LambdaVersion.V1_0,
    );

    new iam.Policy(scope, 'PreTokenGenerationUserReadPolicy', {
        roles: [preTokenFunction.role!],
        statements: [new iam.PolicyStatement({
                actions: ['cognito-idp:AdminGetUser'],
                resources: [userPool.userPoolArn],
            }),],
    });

    const userPoolDomain = userPool.addDomain('CognitoDomain', {
        cognitoDomain: { domainPrefix },
        managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });

    return { userPool, userPoolDomain };
}
