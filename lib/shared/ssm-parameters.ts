import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export const AUTH_SSM_PARAMETER_NAMES = {
    USER_POOL_ID: '/blockbuster-theatre/auth/user-pool-id',
    USER_POOL_ARN: '/blockbuster-theatre/auth/user-pool-arn',
    BACKEND_CLIENT_ID: '/blockbuster-theatre/auth/clients/backend-id',
    POSTMAN_CLIENT_ID: '/blockbuster-theatre/auth/clients/postman-id',
    ALEXA_CLIENT_ID: '/blockbuster-theatre/auth/clients/alexa-id',
} as const;

export interface AuthParameters {
    readonly userPoolId: string;
    readonly userPoolArn: string;
    readonly backendClientId: string;
    readonly postmanClientId: string;
    readonly alexaClientId: string;
}

export interface WriteAuthParametersProps {
    readonly userPoolId: string;
    readonly userPoolArn: string;
    readonly backendClientId: string;
    readonly postmanClientId: string;
    readonly alexaClientId: string;
}

export class AuthSsmHelper {
    public static writeAuthParameters(scope: Construct, props: WriteAuthParametersProps): void {
        new ssm.StringParameter(scope, 'AuthUserPoolIdParameter', {
            parameterName: AUTH_SSM_PARAMETER_NAMES.USER_POOL_ID,
            stringValue: props.userPoolId,
            description: 'Shared Cognito User Pool ID',
        });

        new ssm.StringParameter(scope, 'AuthUserPoolArnParameter', {
            parameterName: AUTH_SSM_PARAMETER_NAMES.USER_POOL_ARN,
            stringValue: props.userPoolArn,
            description: 'Shared Cognito User Pool ARN',
        });

        new ssm.StringParameter(scope, 'AuthBackendClientIdParameter', {
            parameterName: AUTH_SSM_PARAMETER_NAMES.BACKEND_CLIENT_ID,
            stringValue: props.backendClientId,
            description: 'Shared Cognito Backend Client ID (SRP)',
        });

        new ssm.StringParameter(scope, 'AuthPostmanClientIdParameter', {
            parameterName: AUTH_SSM_PARAMETER_NAMES.POSTMAN_CLIENT_ID,
            stringValue: props.postmanClientId,
            description: 'Shared Cognito Postman App Client ID (OAuth)',
        });

        new ssm.StringParameter(scope, 'AuthAlexaClientIdParameter', {
            parameterName: AUTH_SSM_PARAMETER_NAMES.ALEXA_CLIENT_ID,
            stringValue: props.alexaClientId,
            description: 'Shared Cognito Alexa App Client ID (OAuth)',
        });
    }

    public static readAuthParameters(scope: Construct, overrides?: Partial<AuthParameters>): AuthParameters {
        return {
            userPoolId:
                overrides?.userPoolId ??
                ssm.StringParameter.valueForStringParameter(scope, AUTH_SSM_PARAMETER_NAMES.USER_POOL_ID),
            userPoolArn:
                overrides?.userPoolArn ??
                ssm.StringParameter.valueForStringParameter(scope, AUTH_SSM_PARAMETER_NAMES.USER_POOL_ARN),
            backendClientId:
                overrides?.backendClientId ??
                ssm.StringParameter.valueForStringParameter(
                    scope,
                    AUTH_SSM_PARAMETER_NAMES.BACKEND_CLIENT_ID,
                ),
            postmanClientId:
                overrides?.postmanClientId ??
                ssm.StringParameter.valueForStringParameter(
                    scope,
                    AUTH_SSM_PARAMETER_NAMES.POSTMAN_CLIENT_ID,
                ),
            alexaClientId:
                overrides?.alexaClientId ??
                ssm.StringParameter.valueForStringParameter(scope, AUTH_SSM_PARAMETER_NAMES.ALEXA_CLIENT_ID),
        };
    }
}
