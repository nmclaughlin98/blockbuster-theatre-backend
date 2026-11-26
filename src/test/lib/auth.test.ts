import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { CognitoStack } from '../../../lib/auth';
import { AUTH_SSM_PARAMETER_NAMES } from '../../../lib/shared';

describe('AuthenticationConstruct', () => {
    it('imports the configured prod pool and client without creating auth resources in dev', () => {
        const stack = new cdk.Stack();
        const auth = new AuthenticationConstruct(stack, 'Auth', {
            envName: 'dev',
            prodUserPoolId: 'eu-west-2_sharedpool',
            prodUserPoolClientId: 'sharedclientid',
        });

        expect(auth.userPool.userPoolId).toBe('eu-west-2_sharedpool');
        expect(auth.userPoolClient.userPoolClientId).toBe('sharedclientid');
        expect(auth.loginUrl).toBeUndefined();
        expect(auth.jwtAuthorizer).toBeDefined();
    });

    it('uses CloudFormation parameters when dev pool values are not supplied', () => {
        const stack = new cdk.Stack();
        const auth = new AuthenticationConstruct(stack, 'Auth', { envName: 'dev' });
        new cdk.CfnOutput(stack, 'ImportedPoolId', { value: auth.userPool.userPoolId });
        new cdk.CfnOutput(stack, 'ImportedClientId', {
            value: auth.userPoolClient.userPoolClientId,
        });

        const template = Template.fromStack(stack).toJSON();
        expect(template.Parameters).toMatchObject({
            ProdUserPoolId: { Type: 'String' },
            ProdUserPoolClientId: { Type: 'String' },
            ProdPostmanClientId: { Type: 'String', MinLength: 1 },
        });
        expect(template.Outputs.ImportedPoolId.Value).toEqual({ Ref: 'ProdUserPoolId' });
        expect(template.Outputs.ImportedClientId.Value).toEqual({ Ref: 'ProdUserPoolClientId' });
    });

    it('only parameterizes values not explicitly configured', () => {
        const stack = new cdk.Stack();
        new AuthenticationConstruct(stack, 'Auth', {
            envName: 'dev',
            prodUserPoolId: 'eu-west-2_sharedpool',
        });

        const parameters = Template.fromStack(stack).toJSON().Parameters;
        expect(parameters.ProdUserPoolId).toBeUndefined();
        expect(parameters.ProdUserPoolClientId.Type).toBe('String');
    });

    it('creates an invite-only Cognito pool with backend and OAuth clients', () => {
        const stack = new cdk.Stack();
        new AuthenticationConstruct(stack, 'Auth');

        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Cognito::UserPool', {
            UserPoolName: 'blockbuster-theatre-users-PROD',
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
            ClientName: 'blockbuster-theatre-backend-PROD',
            GenerateSecret: false,
            ExplicitAuthFlows: Match.arrayWith([
                'ALLOW_ADMIN_USER_PASSWORD_AUTH',
                'ALLOW_USER_SRP_AUTH',
            ]),
            EnableTokenRevocation: true,
        });
        template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
            ClientName: 'postman-test-client-PROD',
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

    it('binds a dedicated V1 pre-token trigger with pool-scoped, cycle-free permissions', () => {
        const stack = new cdk.Stack();
        new AuthenticationConstruct(stack, 'Auth');
        const template = Template.fromStack(stack);
        const poolId = Object.keys(template.findResources('AWS::Cognito::UserPool'))[0];
        const functions = template.findResources('AWS::Lambda::Function', {
            Properties: { FunctionName: 'blockbuster-theatre-pre-token-generation-handler-PROD' },
        });
        const functionId = Object.keys(functions)[0];
        const roleId = functions[functionId].Properties.Role['Fn::GetAtt'][0];

        template.hasResourceProperties('AWS::Cognito::UserPool', {
            LambdaConfig: {
                PreTokenGenerationConfig: {
                    LambdaArn: { 'Fn::GetAtt': [functionId, 'Arn'] },
                    LambdaVersion: 'V1_0',
                },
            },
        });
        template.hasResourceProperties('AWS::Lambda::Permission', {
            Action: 'lambda:InvokeFunction',
            Principal: 'cognito-idp.amazonaws.com',
            FunctionName: { 'Fn::GetAtt': [functionId, 'Arn'] },
            SourceArn: { 'Fn::GetAtt': [poolId, 'Arn'] },
        });
        const policies = template.findResources('AWS::IAM::Policy', {
            Properties: {
                Roles: [{ Ref: roleId }],
                PolicyDocument: {
                    Statement: Match.arrayWith([{
                        Action: 'cognito-idp:AdminGetUser',
                        Effect: 'Allow',
                        Resource: { 'Fn::GetAtt': [poolId, 'Arn'] },
                    }]),
                },
            },
        });
        expect(Object.keys(policies)).toHaveLength(1);
        expect(functions[functionId].DependsOn ?? []).not.toContain(Object.keys(policies)[0]);

        const resources: Record<string, { DependsOn?: string[]; Properties?: unknown }> =
            template.toJSON().Resources;
        const visited = new Set<string>();
        const visiting = new Set<string>();
        const references = (value: unknown, found: Set<string>): void => {
            if (Array.isArray(value)) {
                value.forEach((item) => references(item, found));
            } else if (value && typeof value === 'object') {
                const object = value as Record<string, unknown>;
                if (typeof object.Ref === 'string') found.add(object.Ref);
                const getAtt = object['Fn::GetAtt'];
                if (Array.isArray(getAtt) && typeof getAtt[0] === 'string') found.add(getAtt[0]);
                if (typeof getAtt === 'string') found.add(getAtt.split('.')[0]);
                const sub = object['Fn::Sub'];
                const expression = typeof sub === 'string' ? sub : Array.isArray(sub) ? sub[0] : undefined;
                if (typeof expression === 'string') {
                    for (const match of expression.matchAll(/\$\{([A-Za-z0-9]+)(?:\.[^}]*)?\}/g)) {
                        found.add(match[1]);
                    }
                }
                Object.values(object).forEach((item) => references(item, found));
            }
        };
        const visit = (id: string): void => {
            if (visiting.has(id)) throw new Error(`CloudFormation dependency cycle at ${id}`);
            if (visited.has(id) || !resources[id]) return;
            visiting.add(id);
            const dependencies = new Set(resources[id].DependsOn ?? []);
            references(resources[id].Properties, dependencies);
            dependencies.forEach(visit);
            visiting.delete(id);
            visited.add(id);
        };
        Object.keys(resources).forEach(visit);
    });
});
