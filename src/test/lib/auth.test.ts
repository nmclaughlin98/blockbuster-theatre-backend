import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { AuthenticationConstruct } from '../../../lib/stack';

describe('AuthenticationConstruct', () => {
    it('creates an invite-only Cognito pool and a public SRP app client', () => {
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
        template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
            ClientName: 'blockbuster-theatre-frontend',
            GenerateSecret: false,
            ExplicitAuthFlows: Match.arrayWith(['ALLOW_USER_SRP_AUTH']),
            EnableTokenRevocation: true,
        });
    });
});
