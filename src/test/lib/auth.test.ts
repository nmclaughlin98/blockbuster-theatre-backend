import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { AuthenticationConstruct } from '../../../lib/stack';

describe.each(['prod', 'dev'] as const)('shared Cognito authentication in %s', (envName) => {
    it('imports the configured pool and clients without creating or changing shared resources', () => {
        const stack = new cdk.Stack();
        const auth = new AuthenticationConstruct(stack, 'Auth', {
            envName,
            prodUserPoolId: 'eu-west-2_sharedpool',
            prodUserPoolClientId: 'sharedclientid',
            prodPostmanClientId: 'postmanclientid',
        });
        expect(auth.userPool.userPoolId).toBe('eu-west-2_sharedpool');
        expect(auth.userPoolClient.userPoolClientId).toBe('sharedclientid');
        expect(auth.jwtAuthorizer).toBeDefined();
        const template = Template.fromStack(stack);
        for (const type of [
            'AWS::Cognito::UserPool',
            'AWS::Cognito::UserPoolClient',
            'AWS::Cognito::UserPoolDomain',
            'AWS::Cognito::ManagedLoginBranding',
            'AWS::Lambda::Function',
            'AWS::Lambda::Permission',
        ]) template.resourceCountIs(type, 0);
    });

    it('requires CloudFormation parameters for values not configured', () => {
        const stack = new cdk.Stack();
        const auth = new AuthenticationConstruct(stack, 'Auth', { envName });
        new cdk.CfnOutput(stack, 'PoolId', { value: auth.userPool.userPoolId });
        const template = Template.fromStack(stack).toJSON();
        expect(template.Parameters).toMatchObject({
            ProdUserPoolId: { Type: 'String', MinLength: 1 },
            ProdUserPoolClientId: { Type: 'String', MinLength: 1 },
            ProdPostmanClientId: { Type: 'String', MinLength: 1 },
        });
        expect(template.Outputs.PoolId.Value).toEqual({ Ref: 'ProdUserPoolId' });
    });
});
