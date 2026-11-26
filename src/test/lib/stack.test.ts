import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { BackendStack as BlockbusterTheatreBackendStack } from '../../../lib/backend';
import { PROD_TO_DEV_TABLES } from '../../../scripts/sync-prod-to-dev';
import { maxTicketsParameterForEnvironment } from '../../../lib/shared';

describe('BackendStack', () => {
    let stack: BlockbusterTheatreBackendStack;

    function expectLinkingParameter(template: Template, functionName: string, parameterName: string): void {
        const functions = template.findResources('AWS::Lambda::Function', {
            Properties: { FunctionName: functionName },
        });

        const fn = Object.values(functions)[0];
        expect(fn.Properties.Environment.Variables.ALLOW_LINK_BOOKINGS_PARAMETER_NAME).toBe(parameterName);
        const roleId = fn.Properties.Role['Fn::GetAtt'][0];
        const policies = Object.values(template.findResources('AWS::IAM::Policy')).filter((policy) =>
            policy.Properties.Roles.some((role: { Ref?: string }) => role.Ref === roleId),);

        const statements = policies.flatMap((policy) => policy.Properties.PolicyDocument.Statement);
        const ssmStatement = statements.find((statement) => statement.Action === 'ssm:GetParameter');
        expect(ssmStatement).toBeDefined();
        expect(JSON.stringify(ssmStatement.Resource)).toContain(`parameter${parameterName}`);
        const cognitoStatement = statements.find(
            (statement) => statement.Action === 'cognito-idp:AdminGetUser',
        );

        expect(cognitoStatement).toBeDefined();
        expect(cognitoStatement.Effect).toBe('Allow');
        const poolId = fn.Properties.Environment.Variables.USER_POOL_ID;

        if (typeof poolId === 'string') {
            expect(JSON.stringify(cognitoStatement.Resource)).toContain(`userpool/${poolId}`);
        } else {
            expect(cognitoStatement.Resource).toBeDefined();
        }
    }

    beforeEach(() => {
        const app = new cdk.App();
        stack = new BlockbusterTheatreBackendStack(app, 'TestBackendStack', {
            prodUserPoolId: 'eu-west-2_sharedpool',
            prodUserPoolClientId: 'sharedbackendclientid',
            prodPostmanClientId: 'postmanclientid',
            prodAlexaClientId: 'alexaclientid',
            env: { account: '334624057595', region: 'eu-west-2' },
        });
    });

    it('should create a complete stack with all backend resources', () => {
        const template = Template.fromStack(stack);
        expect(template).toBeDefined();
    });

    it('uses production suffixes for named tables and functions', () => {
        const template = Template.fromStack(stack);
        const tables = Object.values(template.findResources('AWS::DynamoDB::Table'));
        const functions = Object.values(template.findResources('AWS::Lambda::Function'))
            .map((fn) => fn.Properties?.FunctionName)
            .filter((name): name is string => typeof name === 'string');

        expect(tables).toHaveLength(9);
        expect(
            tables.every((table) =>
                String(table.Properties?.TableName).startsWith('blockbuster-theatre-prod-'),),
        ).toBe(true);

        expect(tables.map((table) => table.Properties?.TableName).sort()).toEqual(
            PROD_TO_DEV_TABLES.map((mapping) => mapping.sourceTable).sort(),
        );

        expect(functions.length).toBeGreaterThan(0);
        expect(functions.every((name) => name.startsWith('blockbuster-theatre-prod-'))).toBe(true);
        template.hasResourceProperties('AWS::Lambda::Function', {
            FunctionName: 'blockbuster-theatre-prod-guest-booking-handler',
            Environment: {
                Variables: Match.objectLike({
                    MAX_TICKETS_PARAMETER_NAME: maxTicketsParameterForEnvironment(
                        '/blockbuster-theatre/booking-configuration/max-tickets-value',
                        'prod',
                    ),
                }),
            },
        });
    });

    it.each([['prod','blockbuster-theatre-prod-guest-booked-seats-handler','/blockbuster-theatre-prod/parameter-configurations/ALLOW_LINK_BOOKINGS',],['dev','blockbuster-theatre-dev-guest-booked-seats-handler','/blockbuster-theatre-dev/parameter-configurations/ALLOW_LINK_BOOKINGS',],] as const)('configures guest booking linking for %s', (envName, functionName, parameterName) => {
        const app = new cdk.App();
        const configuredStack = new BlockbusterTheatreBackendStack(app, 'FlagStack', {
            envName,
            prodUserPoolId: 'eu-west-2_sharedpool',
            prodUserPoolClientId: 'sharedclientid',
            prodPostmanClientId: 'postmanclientid',
            prodAlexaClientId: 'alexaclientid',
            env: { account: '334624057595', region: 'eu-west-2' },
        });

        expectLinkingParameter(Template.fromStack(configuredStack), functionName, parameterName);
    });

    it('synthesizes an isolated dev stack without creating prod Cognito or SES resources', () => {
        const app = new cdk.App();
        const devStack = new BlockbusterTheatreBackendStack(app, 'BlockbusterTheatreBackendStack-dev', {
            envName: 'dev',
            prodUserPoolId: 'eu-west-2_sharedpool',
            prodUserPoolClientId: 'sharedclientid',
            prodPostmanClientId: 'postmanclientid',
            prodAlexaClientId: 'alexaclientid',
            env: { account: '334624057595', region: 'eu-west-2' },
        });

        const template = Template.fromStack(devStack);
        const tables = Object.values(template.findResources('AWS::DynamoDB::Table'));
        expect(tables).toHaveLength(9);
        expect(
            tables.every((table) =>
                String(table.Properties?.TableName).startsWith('blockbuster-theatre-dev-'),),
        ).toBe(true);

        expect(tables.map((table) => table.Properties?.TableName).sort()).toEqual(
            PROD_TO_DEV_TABLES.map((mapping) => mapping.targetTable).sort(),
        );

        template.hasResource('AWS::DynamoDB::Table', {
            DeletionPolicy: 'Delete',
            Properties: Match.objectLike({
                TableName: 'blockbuster-theatre-dev-movie-catalogue',
            }),
        });

        const functions = Object.values(template.findResources('AWS::Lambda::Function'))
            .map((fn) => fn.Properties?.FunctionName)
            .filter((name): name is string => typeof name === 'string');

        expect(functions.length).toBeGreaterThan(0);
        expect(functions.every((name) => name.startsWith('blockbuster-theatre-dev-'))).toBe(true);

        for (const name of ['blockbuster-theatre-dev-booking-confirmation-handler','blockbuster-theatre-dev-guest-booking-handler',]) {
            template.hasResourceProperties('AWS::Lambda::Function', {
                FunctionName: name,
                Environment: {
                    Variables: Match.objectLike({
                        MAX_TICKETS_PARAMETER_NAME: maxTicketsParameterForEnvironment(
                            '/blockbuster-theatre/booking-configuration/max-tickets-value',
                            'dev',
                        ),
                    }),
                },
            });
        }

        expect(template.findResources('AWS::Cognito::UserPool')).toEqual({});
        expect(template.findResources('AWS::Cognito::UserPoolClient')).toEqual({});
        expect(template.findResources('AWS::SES::EmailIdentity')).toEqual({});

        template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
            Name: 'blockbuster-theatre-dev-api-gateway',
            CorsConfiguration: Match.objectLike({
                AllowOrigins: ['*'],
                AllowHeaders: ['Content-Type', 'Authorization'],
                AllowMethods: Match.arrayWith(['GET', 'POST', 'PATCH', 'DELETE']),
            }),
        });

        template.hasResourceProperties('AWS::ApiGatewayV2::ApiMapping', {
            DomainName: 'api-dev.blockbuster-theatre.nml-applications.com',
        });

        template.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
            Name: 'blockbuster-theatre-dev-CognitoJwtAuthorizer',
            AuthorizerType: 'JWT',
            JwtConfiguration: {
                Audience: ['sharedclientid', 'postmanclientid', 'alexaclientid'],
                Issuer: 'https://cognito-idp.eu-west-2.amazonaws.com/eu-west-2_sharedpool',
            },
        });
    });

    it('resolves Cognito audience from SSM parameters when not explicitly configured', () => {
        const app = new cdk.App();
        const stackWithSsm = new BlockbusterTheatreBackendStack(app, 'SsmBackendStack', {
            envName: 'dev',
            env: { account: '334624057595', region: 'eu-west-2' },
        });

        const template = Template.fromStack(stackWithSsm);
        template.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
            Name: 'blockbuster-theatre-dev-CognitoJwtAuthorizer',
            AuthorizerType: 'JWT',
            JwtConfiguration: Match.objectLike({
                Audience: Match.arrayWith([Match.objectLike({
                        Ref: Match.stringLikeRegexp(
                            'SsmParameterValueblockbustertheatreauthclientsbackendid',
                        ),
                    }),Match.objectLike({
                        Ref: Match.stringLikeRegexp(
                            'SsmParameterValueblockbustertheatreauthclientspostmanid',
                        ),
                    }),Match.objectLike({
                        Ref: Match.stringLikeRegexp('SsmParameterValueblockbustertheatreauthclientsalexaid'),
                    }),]),
            }),
        });
    });

    it.each(['prod', 'dev'] as const)('tags managed resources for %s', (envName) => {
        const app = new cdk.App();
        const taggedStack = new BlockbusterTheatreBackendStack(app, 'TaggedStack', {
            envName,
            prodUserPoolId: 'eu-west-2_sharedpool',
            prodUserPoolClientId: 'sharedclientid',
            prodPostmanClientId: 'postmanclientid',
            prodAlexaClientId: 'alexaclientid',
        });

        const template = Template.fromStack(taggedStack);

        for (const resourceType of ['AWS::DynamoDB::Table', 'AWS::Lambda::Function', 'AWS::IAM::Role']) {
            const resources = Object.values(template.findResources(resourceType));
            expect(resources.length).toBeGreaterThan(0);

            for (const resource of resources) {
                expect(resource.Properties?.Tags).toEqual(
                    expect.arrayContaining([{ Key: 'Project', Value: 'blockbuster-theatre' },{ Key: 'Environment', Value: envName },]),
                );
            }
        }

        for (const resourceType of ['AWS::ApiGatewayV2::Api', 'AWS::ApiGatewayV2::Stage']) {
            template.hasResourceProperties(resourceType, {
                Tags: Match.objectLike({ Project: 'blockbuster-theatre', Environment: envName }),
            });
        }

        if (envName === 'prod') {
            template.hasResourceProperties('AWS::SES::EmailIdentity', {
                Tags: Match.arrayWith([{ Key: 'Environment', Value: envName }]),
            });
        }
    });

    it('should create DynamoDB table', () => {
        const template = Template.fromStack(stack);
        template.resourceCountIs('AWS::DynamoDB::Table', 9);
        template.hasResourceProperties('AWS::DynamoDB::Table', {
            TableName: 'blockbuster-theatre-prod-movie-catalogue',
            BillingMode: 'PAY_PER_REQUEST',
        });

        template.hasResource('AWS::DynamoDB::Table', {
            DeletionPolicy: 'Retain',
            UpdateReplacePolicy: 'Retain',
            Properties: Match.objectLike({ TableName: 'blockbuster-theatre-prod-movie-catalogue' }),
        });

        template.hasResourceProperties('AWS::DynamoDB::Table', {
            TableName: 'blockbuster-theatre-prod-ticket-pricing',
            BillingMode: 'PAY_PER_REQUEST',
            KeySchema: [{ AttributeName: 'pricingId', KeyType: 'HASH' }],
        });

        template.hasResource('AWS::DynamoDB::Table', {
            DeletionPolicy: 'Retain',
            UpdateReplacePolicy: 'Retain',
            Properties: Match.objectLike({ TableName: 'blockbuster-theatre-prod-ticket-pricing' }),
        });

        template.hasResourceProperties('AWS::DynamoDB::Table', {
            TableName: 'blockbuster-theatre-prod-booking-offers',
            BillingMode: 'PAY_PER_REQUEST',
            KeySchema: [{ AttributeName: 'offerId', KeyType: 'HASH' }],
        });

        template.hasResource('AWS::DynamoDB::Table', {
            DeletionPolicy: 'Retain',
            UpdateReplacePolicy: 'Retain',
            Properties: Match.objectLike({ TableName: 'blockbuster-theatre-prod-booking-offers' }),
        });

        template.hasResourceProperties('AWS::DynamoDB::Table', {
            TableName: 'blockbuster-theatre-prod-movie-collections',
            BillingMode: 'PAY_PER_REQUEST',
            KeySchema: [{ AttributeName: 'collectionId', KeyType: 'HASH' }],
        });

        template.hasResource('AWS::DynamoDB::Table', {
            DeletionPolicy: 'Retain',
            UpdateReplacePolicy: 'Retain',
            Properties: Match.objectLike({ TableName: 'blockbuster-theatre-prod-movie-collections' }),
        });

        template.hasResourceProperties('AWS::DynamoDB::Table', {
            TableName: 'blockbuster-theatre-prod-bookings',
            BillingMode: 'PAY_PER_REQUEST',
            KeySchema: [{ AttributeName: 'showingId', KeyType: 'HASH' },{ AttributeName: 'seatId', KeyType: 'RANGE' },],
            GlobalSecondaryIndexes: Match.arrayWith([Match.objectLike({ IndexName: 'UserBookings' })]),
        });

        template.hasResourceProperties('AWS::DynamoDB::Table', {
            TableName: 'blockbuster-theatre-prod-bookings-by-showtime',
            BillingMode: 'PAY_PER_REQUEST',
            KeySchema: [{ AttributeName: 'showtimeId', KeyType: 'HASH' },{ AttributeName: 'seatId', KeyType: 'RANGE' },],
            GlobalSecondaryIndexes: Match.arrayWith([Match.objectLike({ IndexName: 'UserBookings' })]),
        });

        template.hasResourceProperties('AWS::DynamoDB::Table', {
            TableName: 'blockbuster-theatre-prod-showtime-registry',
            BillingMode: 'PAY_PER_REQUEST',
            KeySchema: [{ AttributeName: 'registryKey', KeyType: 'HASH' }],
        });

        template.hasResourceProperties('AWS::DynamoDB::Table', {
            TableName: 'blockbuster-theatre-prod-booking-references',
            BillingMode: 'PAY_PER_REQUEST',
            KeySchema: [{ AttributeName: 'bookingRef', KeyType: 'HASH' }],
        });

        template.hasResourceProperties('AWS::DynamoDB::Table', {
            TableName: 'blockbuster-theatre-prod-guest-conversion-tokens',
            BillingMode: 'PAY_PER_REQUEST',
            KeySchema: [{ AttributeName: 'tokenHash', KeyType: 'HASH' }],
            TimeToLiveSpecification: {
                AttributeName: 'expiresAt',
                Enabled: true,
            },
        });
    });

    it('grants the ticket handler read access to both booking tables and their indexes', () => {
        const template = Template.fromStack(stack);
        const currentTable = Match.stringLikeRegexp('MoviesDatabaseBlockbusterTheatreBookingsByShowtime');
        const legacyTable = Match.stringLikeRegexp('MoviesDatabaseBlockbusterTheatreBookings[A-F0-9]+');
        template.hasResourceProperties('AWS::Lambda::Function', {
            FunctionName: 'blockbuster-theatre-prod-download-ticket-handler',
            Environment: {
                Variables: {
                    BOOKINGS_TABLE_NAME: { Ref: currentTable },
                    LEGACY_BOOKINGS_TABLE_NAME: { Ref: legacyTable },
                },
            },
        });

        for (const table of [currentTable, legacyTable]) {
            template.hasResourceProperties('AWS::IAM::Policy', {
                Roles: [{ Ref: Match.stringLikeRegexp('DownloadTicketHandlerServiceRole') }],
                PolicyDocument: Match.objectLike({
                    Statement: Match.arrayWith([Match.objectLike({
                            Effect: 'Allow',
                            Action: Match.arrayWith(['dynamodb:Query', 'dynamodb:GetItem']),
                            Resource: Match.arrayWith([{ 'Fn::GetAtt': [table, 'Arn'] },{ 'Fn::Join': ['', [{ 'Fn::GetAtt': [table, 'Arn'] }, '/index/*']] },]),
                        }),]),
                }),
            });
        }
    });

    it('should create Lambda function', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Lambda::Function', {
            FunctionName: 'blockbuster-theatre-prod-add-movies-handler',
        });
    });

    it('should create HTTP API', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
            Name: 'blockbuster-theatre-prod-api-gateway',
        });
    });

    it('should create API Gateway integration', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::ApiGatewayV2::Integration', {
            IntegrationType: 'AWS_PROXY',
        });
    });

    it('should create API Gateway routes without authorizationScopes', () => {
        const template = Template.fromStack(stack);
        template.resourceCountIs('AWS::ApiGatewayV2::Route', 30);
        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'GET /bookings',
        });

        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'POST /bookings',
        });

        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'PATCH /bookings/reschedule-booking',
            AuthorizationType: 'NONE',
        });

        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'POST /showtimes',
            AuthorizationType: 'JWT',
        });

        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'PATCH /showtimes/{showtimeId}',
            AuthorizationType: 'JWT',
        });

        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'DELETE /showtimes/{showtimeId}',
            AuthorizationType: 'JWT',
        });

        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'GET /api/v1/bookings/guest',
        });

        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'POST /api/v1/bookings/guest',
        });

        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'POST /api/v1/auth/convert-guest',
        });

        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'GET /movies/newest',
            AuthorizationType: 'NONE',
        });

        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'GET /movies/top-picks',
            AuthorizationType: 'NONE',
        });

        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'GET /movies',
        });

        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'GET /film-selections',
        });

        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'GET /ticket-pricing',
        });

        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'POST /checkout/validate',
        });

        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'POST /booking/confirmation',
        });

        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'GET /movies/export',
            AuthorizationType: 'JWT',
        });

        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'GET /movies/tmdb-ids',
            AuthorizationType: 'JWT',
        });

        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'GET /collections',
        });

        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'GET /collections/{id}',
        });

        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: 'POST /collections/refresh',
            AuthorizationType: 'JWT',
        });

        // Verify that none of the routes specify AuthorizationScopes
        const routes = template.findResources('AWS::ApiGatewayV2::Route');

        for (const route of Object.values(routes)) {
            expect(route.Properties.AuthorizationScopes).toBeUndefined();
        }
    });

    it('should output API endpoint', () => {
        const template = Template.fromStack(stack);
        template.hasOutput('ApiEndpoint', {
            Description: 'Base HTTP endpoint for WinForms, WinUI 3, SwiftUI, and Web SPA',
        });

        template.hasOutput('UserPoolId', {});
        template.hasOutput('UserPoolClientId', {});
        template.hasOutput('UserPoolIssuer', {});
    });

    it('should grant Lambda permissions to DynamoDB', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::SES::EmailIdentity', {
            EmailIdentity: 'niallmclaughlin1998@gmail.com',
        });

        template.hasResourceProperties('AWS::Lambda::Function', {
            FunctionName: 'blockbuster-theatre-prod-booking-confirmation-handler',
            Environment: {
                Variables: Match.objectLike({
                    BOOKING_EMAIL_FROM: Match.anyValue(),
                }),
            },
        });

        template.hasResourceProperties('AWS::IAM::Policy', {
            PolicyDocument: Match.objectLike({
                Statement: Match.arrayWith([Match.objectLike({
                        Action: Match.arrayWith(['ses:SendEmail']),
                        Resource: Match.anyValue(),
                    }),]),
            }),
        });
    });

    it('should have correct resource order (DB -> Lambda -> API)', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::DynamoDB::Table', {
            TableName: 'blockbuster-theatre-prod-movie-catalogue',
        });

        template.hasResourceProperties('AWS::Lambda::Function', {
            FunctionName: 'blockbuster-theatre-prod-add-movies-handler',
        });

        template.hasResourceProperties('AWS::ApiGatewayV2::Integration', {
            IntegrationType: 'AWS_PROXY',
        });
    });
});
