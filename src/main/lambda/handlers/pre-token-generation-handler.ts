import {
    AdminGetUserCommand,
    CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import type { PreTokenGenerationTriggerEvent } from 'aws-lambda';
import { log } from './utils/common';

const cognitoClient = new CognitoIdentityProviderClient({});

export const handler = async (
    event: PreTokenGenerationTriggerEvent
): Promise<PreTokenGenerationTriggerEvent> => {
    let user;
    try {
        user = await cognitoClient.send(new AdminGetUserCommand({
            UserPoolId: event.userPoolId,
            Username: event.userName,
        }));
    } catch (error: unknown) {
        log('ERROR', 'Failed to retrieve user creation date', {
            errorName: error instanceof Error ? error.name : 'UnknownError',
        });
        throw new Error('Unable to generate token claims.');
    }

    if (!(user.UserCreateDate instanceof Date) || Number.isNaN(user.UserCreateDate.getTime())) {
        log('ERROR', 'Cognito returned an invalid user creation date');
        throw new Error('Unable to generate token claims.');
    }

    const overrides = event.response?.claimsOverrideDetails;
    event.response = {
        ...event.response,
        claimsOverrideDetails: {
            ...overrides,
            claimsToAddOrOverride: {
                ...overrides?.claimsToAddOrOverride,
                member_since: user.UserCreateDate.toISOString(),
            },
            groupOverrideDetails: overrides?.groupOverrideDetails ?? event.request.groupConfiguration,
        },
    };
    return event;
};
