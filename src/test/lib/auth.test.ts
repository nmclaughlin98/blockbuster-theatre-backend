import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { AuthenticationConstruct } from '../../../lib/stack';

describe('AuthenticationConstruct', () => {
    it('creates an invite-only Cognito pool with backend and OAuth clients', () => {
        const stack = new cdk.Stack();
        new AuthenticationConstruct(stack, 'Auth');

        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Cognito::UserPool', {
            UserPoolName: 'blockbuster-theatre-users',
            UsernameAttributes: ['email'],
            AdminCreateUserConfig: {
                AllowAdminCreateUserOnly: true,
            },
        });
        template.hasResourceProperties('AWS::Cognito::UserPoolDomain', {
            Domain: 'blockbuster-theatre',
            ManagedLoginVersion: 2,
        });
        template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
            ClientName: 'blockbuster-theatre-backend',
            GenerateSecret: false,
            ExplicitAuthFlows: Match.arrayWith(['ALLOW_USER_SRP_AUTH']),
            EnableTokenRevocation: true,
        });
        template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
            ClientName: 'postman-test-client',
            GenerateSecret: false,
            AllowedOAuthFlows: ['code'],
            CallbackURLs: [
                'https://oauth.pstmn.io/v1/callback',
                'https://oauth.pstmn.io/v1/browser-callback',
            ],
        });
        template.hasResourceProperties('AWS::Cognito::ManagedLoginBranding', {
            Settings: {
                categories: {
                    global: {
                        colorSchemeMode: 'DARK',
                    },
                },
            },
        });
    });
});
