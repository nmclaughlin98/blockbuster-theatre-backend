import {
    AdminGetUserCommand,
    CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import type { PreTokenGenerationTriggerEvent } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../main/lambda/handlers/pre-token-generation-handler';

const cognitoMock = mockClient(CognitoIdentityProviderClient);

function event(): PreTokenGenerationTriggerEvent {
    return {
        version: '1',
        triggerSource: 'TokenGeneration_Authentication',
        region: 'eu-west-2',
        userPoolId: 'eu-west-2_pool',
        userName: 'user-name',
        callerContext: { awsSdkVersion: '1', clientId: 'client-id' },
        request: {
            userAttributes: { sub: 'user-id' },
            groupConfiguration: { groupsToOverride: ['members'] },
        },
        response: { claimsOverrideDetails: {} },
    };
}

describe('pre-token generation handler', () => {
    beforeEach(() => {
        cognitoMock.reset();
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => jest.restoreAllMocks());

    it('adds the creation date while preserving existing claims and group overrides', async () => {
        const request = event();
        request.response.claimsOverrideDetails = {
            claimsToAddOrOverride: { existing: 'value', member_since: 'old' },
            claimsToSuppress: ['other'],
            groupOverrideDetails: { groupsToOverride: ['custom'] },
        };
        cognitoMock.on(AdminGetUserCommand).resolves({
            UserCreateDate: new Date('2024-04-03T12:34:56.789Z'),
        });

        const result = await handler(request);

        expect(cognitoMock.commandCalls(AdminGetUserCommand)[0].args[0].input).toEqual({
            UserPoolId: 'eu-west-2_pool',
            Username: 'user-name',
        });
        expect(result.response.claimsOverrideDetails).toEqual({
            claimsToAddOrOverride: {
                existing: 'value',
                member_since: '2024-04-03T12:34:56.789Z',
            },
            claimsToSuppress: ['other'],
            groupOverrideDetails: { groupsToOverride: ['custom'] },
        });
        expect(result.request).toEqual(request.request);
    });

    it('initializes overrides and preserves Cognito groups on token refresh', async () => {
        const request = event();
        request.triggerSource = 'TokenGeneration_RefreshTokens';
        Reflect.deleteProperty(request.response, 'claimsOverrideDetails');
        cognitoMock.on(AdminGetUserCommand).resolves({
            UserCreateDate: new Date('2020-01-01T00:00:00.000Z'),
        });

        const result = await handler(request);
        expect(result.response.claimsOverrideDetails).toEqual({
            claimsToAddOrOverride: { member_since: '2020-01-01T00:00:00.000Z' },
            groupOverrideDetails: { groupsToOverride: ['members'] },
        });
    });

    it.each([undefined, new Date('invalid')])(
        'rejects a missing or invalid creation date',
        async (UserCreateDate) => {
            cognitoMock.on(AdminGetUserCommand).resolves({ UserCreateDate });
            await expect(handler(event())).rejects.toThrow('Unable to generate token claims.');
        }
    );

    it('fails token generation without exposing a Cognito error', async () => {
        cognitoMock.on(AdminGetUserCommand).rejects(new Error('sensitive details'));
        await expect(handler(event())).rejects.toThrow('Unable to generate token claims.');
        expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('sensitive details'));
    });
});
