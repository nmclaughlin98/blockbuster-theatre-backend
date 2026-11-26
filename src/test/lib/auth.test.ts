import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { CognitoStack } from '../../../lib/auth';
import { AUTH_SSM_PARAMETER_NAMES } from '../../../lib/shared';

describe('BlockbusterTheatreAuthStack', () => {
    let app: cdk.App;
    let stack: CognitoStack;

    beforeEach(() => {
        app = new cdk.App();
        stack = new CognitoStack(app, 'TestBlockbusterTheatreAuthStack', {
            env: { account: '334624057595', region: 'eu-west-2' },
        });
    });

    it('enables termination protection by default', () => {
        expect(stack.terminationProtection).toBe(true);
    });

    it('preserves Cognito resource logical IDs when resources are extracted', () => {
        const resources = Template.fromStack(stack).toJSON().Resources;
        expect(resources.BlockbusterTheatreCognitoUsers309F56C0.Type).toBe('AWS::Cognito::UserPool');
        expect(resources.BlockbusterTheatreCognitoUsersCognitoDomain0BCE2B90.Type).toBe(
            'AWS::Cognito::UserPoolDomain',
        );

        expect(resources.BlockbusterTheatreCognitoUsersBookingsResourceServer2DB5531C.Type).toBe(
            'AWS::Cognito::UserPoolResourceServer',
        );

        expect(resources.BlockbusterTheatreCognitoUsersBackendClientA5AC95EE.Type).toBe(
            'AWS::Cognito::UserPoolClient',
        );
    });

    it('creates the shared Cognito User Pool with self-signup and password policy', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Cognito::UserPool', {
            UserPoolName: blockbuster - theatre - users,
            UsernameAttributes: ['email'],
            AutoVerifiedAttributes: ['email'],
            Policies: {
                PasswordPolicy: {
                    MinimumLength: 12,
                    RequireNumbers: true,
                    RequireLowercase: true,
                    RequireSymbols: true,
                    RequireUppercase: true,
                },
            },
        });
    });

    it('creates the Cognito Domain with managed login', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Cognito::UserPoolDomain', {
            Domain: 'blockbuster-theatre',
            ManagedLoginVersion: 2,
        });
    });

    it('creates PROD and DEV resource servers with the bookings.read scope', () => {
        const template = Template.fromStack(stack);
        template.resourceCountIs('AWS::Cognito::UserPoolResourceServer', 2);

        for (const identifier of ['https://api.blockbuster-theatre.nml-applications.com','https://api-dev.blockbuster-theatre.nml-applications.com',]) {
            template.hasResourceProperties('AWS::Cognito::UserPoolResourceServer', {
                Identifier: identifier,
                Name: 'blockbuster-theatre-bookings-resource-server',
                Scopes: [{ ScopeName: 'bookings.read', ScopeDescription: 'Read customer bookings' }],
            });
        }
    });

    it('creates BackendClient with SRP authentication flows', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
            ClientName: 'blockbuster-theatre-backend',
            GenerateSecret: false,
            ExplicitAuthFlows: Match.arrayEquals(['ALLOW_ADMIN_USER_PASSWORD_AUTH', 'ALLOW_USER_SRP_AUTH']),
            AllowedOAuthFlowsUserPoolClient: false,
            AllowedOAuthScopes: Match.absent(),
            AllowedOAuthFlows: Match.absent(),
            EnableTokenRevocation: true,
        });
    });

    it('creates PostmanAppClient with Authorization Code Grant', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
            ClientName: 'postman-test-client',
            GenerateSecret: false,
            AllowedOAuthFlows: ['code'],
            CallbackURLs: ['https://oauth.pstmn.io/v1/callback','https://oauth.pstmn.io/v1/browser-callback',],
        });
    });

    it('allows the Alexa client to request both environment-specific bookings.read scopes', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
            ClientName: 'alexa-skill-client',
            GenerateSecret: false,
            AllowedOAuthFlows: ['code'],
            CallbackURLs: Match.arrayWith(['https://pitangui.amazon.com/api/skill/link','https://layla.amazon.com/api/skill/link','https://alexa.amazon.co.jp/api/skill/link',]),
        });

        const clients = template.findResources('AWS::Cognito::UserPoolClient');
        const alexaClient = Object.values(clients).find(
            (c) => c.Properties.ClientName === 'alexa-skill-client',
        );

        expect(alexaClient).toBeDefined();
        const scopes = alexaClient!.Properties.AllowedOAuthScopes;
        expect(scopes).toContain('openid');
        expect(scopes).toContain('email');
        expect(scopes).toContain('profile');
        const servers = template.findResources('AWS::Cognito::UserPoolResourceServer');

        for (const identifier of ['https://api.blockbuster-theatre.nml-applications.com','https://api-dev.blockbuster-theatre.nml-applications.com',]) {
            const serverId = Object.keys(servers).find(
                (id) => servers[id].Properties.Identifier === identifier,
            );

            expect(serverId).toBeDefined();
            expect(scopes).toContainEqual({ 'Fn::Join': ['', [{ Ref: serverId }, '/bookings.read']] });
        }

        expect(scopes).toHaveLength(5);
    });

    it('exports User Pool ID, User Pool ARN, and App Client IDs to SSM Parameter Store', () => {
        const template = Template.fromStack(stack);

        template.hasResourceProperties('AWS::SSM::Parameter', {
            Name: AUTH_SSM_PARAMETER_NAMES.USER_POOL_ID,
            Type: 'String',
        });

        template.hasResourceProperties('AWS::SSM::Parameter', {
            Name: AUTH_SSM_PARAMETER_NAMES.USER_POOL_ARN,
            Type: 'String',
        });

        template.hasResourceProperties('AWS::SSM::Parameter', {
            Name: AUTH_SSM_PARAMETER_NAMES.BACKEND_CLIENT_ID,
            Type: 'String',
        });

        template.hasResourceProperties('AWS::SSM::Parameter', {
            Name: AUTH_SSM_PARAMETER_NAMES.POSTMAN_CLIENT_ID,
            Type: 'String',
        });

        template.hasResourceProperties('AWS::SSM::Parameter', {
            Name: AUTH_SSM_PARAMETER_NAMES.ALEXA_CLIENT_ID,
            Type: 'String',
        });
    });

    it('binds the PreTokenGeneration trigger with pool-scoped read permissions', () => {
        const template = Template.fromStack(stack);
        const poolId = Object.keys(template.findResources('AWS::Cognito::UserPool'))[0];
        const functions = template.findResources('AWS::Lambda::Function', {
            Properties: { FunctionName: 'blockbuster-theatre-pre-token-generation-handler' },
        });

        const functionId = Object.keys(functions)[0];

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
    });
});
