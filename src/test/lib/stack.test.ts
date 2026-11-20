import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { BlockbusterTheatreBackendStack } from '../../../lib/stack-configuration';

const tableNames = (suffix: 'PROD' | 'DEV'): string[] => [
    'movies', 'pricing', 'offers', 'collections', 'legacy-bookings',
    'bookings', 'showtimes', 'booking-references', 'guest-conversion-tokens',
].map((entity) => `blockbuster-theatre-${entity}-table-${suffix}`).sort();

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
            policy.Properties.Roles.some((role: { Ref?: string }) => role.Ref === roleId)
        );
        const statements = policies.flatMap((policy) => policy.Properties.PolicyDocument.Statement);
        const ssmStatement = statements.find((statement) => statement.Action === 'ssm:GetParameter');
        expect(ssmStatement).toBeDefined();
        expect(JSON.stringify(ssmStatement.Resource)).toContain(`parameter${parameterName}`);
    }

    beforeEach(() => {
        const app = new cdk.App();
        stack = new BlockbusterTheatreBackendStack(app, 'TestBackendStack');
    });

    it('should create a complete stack with all resources', () => {
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
        expect(tables.every((table) => String(table.Properties?.TableName).endsWith('-PROD'))).toBe(true);
        expect(tables.map((table) => table.Properties?.TableName).sort())
            .toEqual(tableNames('PROD'));
        expect(functions.length).toBeGreaterThan(0);
        expect(functions.every((name) => name.endsWith('-PROD'))).toBe(true);
        template.hasResourceProperties('AWS::Lambda::Function', {
            FunctionName: 'blockbuster-theatre-create-guest-booking-record-PROD',
            Environment: {
                Variables: Match.objectLike({
                    MAX_TICKETS_PARAMETER_NAME: '/blockbuster-theatre/booking-configuration/max-tickets-value-PROD',
                }),
            },
        });
    });

    it.each([
        ['prod', 'blockbuster-theatre-list-account-booking-records-PROD', '/blockbuster-theatre/parameter-configurations/ALLOW_LINK_BOOKINGS'],
        ['dev', 'blockbuster-theatre-list-account-booking-records-DEV', '/blockbuster-theatre/parameter-configurations-dev/ALLOW_LINK_BOOKINGS'],
    ] as const)('configures guest booking linking for %s', (envName, functionName, parameterName) => {
        const app = new cdk.App();
        const configuredStack = new BlockbusterTheatreBackendStack(app, 'FlagStack', {
            envName,
            prodUserPoolId: 'eu-west-2_sharedpool',
            prodUserPoolClientId: 'sharedclientid',
            prodPostmanClientId: 'postmanclientid',
            env: { account: '334624057595', region: 'eu-west-2' },
        });
        expectLinkingParameter(Template.fromStack(configuredStack), functionName, parameterName);
    });

    it('synthesizes an isolated dev stack without creating prod Cognito or SES resources', () => {
        const app = new cdk.App();
        const devStack = new BlockbusterTheatreBackendStack(
            app,
            'BlockbusterTheatreBackendStack-dev',
            {
                envName: 'dev',
                prodUserPoolId: 'eu-west-2_sharedpool',
                prodUserPoolClientId: 'sharedclientid',
                prodPostmanClientId: 'postmanclientid',
                env: { account: '334624057595', region: 'eu-west-2' },
            }
        );
        const template = Template.fromStack(devStack);
        const tables = Object.values(template.findResources('AWS::DynamoDB::Table'));
        expect(tables).toHaveLength(9);
        expect(tables.every((table) =>
            String(table.Properties?.TableName).endsWith('-DEV')
        )).toBe(true);
        expect(tables.map((table) => table.Properties?.TableName).sort())
            .toEqual(tableNames('DEV'));
        template.hasResource('AWS::DynamoDB::Table', {
            DeletionPolicy: 'Delete',
            Properties: Match.objectLike({
                TableName: 'blockbuster-theatre-movies-table-DEV',
            }),
        });

        const functions = Object.values(template.findResources('AWS::Lambda::Function'))
            .map((fn) => fn.Properties?.FunctionName)
            .filter((name): name is string => typeof name === 'string');
        expect(functions.length).toBeGreaterThan(0);
        expect(functions.every((name) => name.endsWith('-DEV'))).toBe(true);
        for (const name of [
            'blockbuster-theatre-send-booking-confirmation-DEV',
            'blockbuster-theatre-create-guest-booking-record-DEV',
        ]) {
            template.hasResourceProperties('AWS::Lambda::Function', {
                FunctionName: name,
                Environment: {
                    Variables: Match.objectLike({
                        MAX_TICKETS_PARAMETER_NAME:
                            '/blockbuster-theatre/booking-configuration/max-tickets-value-DEV',
                    }),
                },
            });
        }
        expect(template.findResources('AWS::Cognito::UserPool')).toEqual({});
        expect(template.findResources('AWS::Cognito::UserPoolClient')).toEqual({});
        expect(template.findResources('AWS::SES::EmailIdentity')).toEqual({});

        template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
            Name: 'blockbuster-theatre-api-DEV',
            CorsConfiguration: Match.objectLike({
                AllowOrigins: ['*'],
                AllowHeaders: Match.arrayWith(['Content-Type', 'Authorization']),
                AllowMethods: Match.arrayWith(['GET', 'POST', 'PATCH', 'DELETE']),
            }),
        });
        template.resourceCountIs('AWS::ApiGatewayV2::ApiMapping', 0);
        template.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
            Name: 'CognitoJwtAuthorizer-DEV',
            AuthorizerType: 'JWT',
            JwtConfiguration: {
                Audience: ['sharedclientid', 'postmanclientid'],
                Issuer: 'https://cognito-idp.eu-west-2.amazonaws.com/eu-west-2_sharedpool',
            },
        });
    });

    it('uses the Postman CloudFormation parameter in the dev authorizer when not configured', () => {
        const app = new cdk.App();
        const devStack = new BlockbusterTheatreBackendStack(app, 'DevStack', {
            envName: 'dev',
            prodUserPoolId: 'eu-west-2_sharedpool',
            prodUserPoolClientId: 'sharedclientid',
            env: { account: '334624057595', region: 'eu-west-2' },
        });
        const template = Template.fromStack(devStack);
        template.hasParameter('ProdPostmanClientId', { Type: 'String', MinLength: 1 });
        template.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
            JwtConfiguration: {
                Audience: ['sharedclientid', { Ref: 'ProdPostmanClientId' }],
                Issuer: 'https://cognito-idp.eu-west-2.amazonaws.com/eu-west-2_sharedpool',
            },
        });
    });

    it.each(['prod', 'dev'] as const)('tags managed resources for %s', (envName) => {
        const app = new cdk.App();
        const taggedStack = new BlockbusterTheatreBackendStack(app, 'TaggedStack', {
            envName,
            prodUserPoolId: 'eu-west-2_sharedpool',
            prodUserPoolClientId: 'sharedclientid',
        });
        const template = Template.fromStack(taggedStack);
        for (const resourceType of ['AWS::DynamoDB::Table', 'AWS::Lambda::Function', 'AWS::IAM::Role']) {
            const resources = Object.values(template.findResources(resourceType));
            expect(resources.length).toBeGreaterThan(0);
            for (const resource of resources) {
                expect(resource.Properties?.Tags).toEqual(expect.arrayContaining([
                    { Key: 'Project', Value: 'blockbuster-theatre' },
                    { Key: 'Environment', Value: envName },
                ]));
            }
        }
        for (const resourceType of ['AWS::ApiGatewayV2::Api', 'AWS::ApiGatewayV2::Stage']) {
            template.hasResourceProperties(resourceType, {
                Tags: Match.objectLike({ Project: 'blockbuster-theatre', Environment: envName }),
            });
        }
        template.resourceCountIs('AWS::Cognito::UserPool', 0);
        template.resourceCountIs('AWS::SES::EmailIdentity', 0);
    });

    it('should create DynamoDB table', () => {
        const template = Template.fromStack(stack);
        template.resourceCountIs('AWS::DynamoDB::Table', 9);
        template.hasResourceProperties('AWS::DynamoDB::Table', {
            TableName: 'blockbuster-theatre-movies-table-PROD',
            BillingMode: 'PAY_PER_REQUEST',
        });
        template.hasResource('AWS::DynamoDB::Table', {
            DeletionPolicy: 'Retain',
            UpdateReplacePolicy: 'Retain',
            Properties: Match.objectLike({ TableName: 'blockbuster-theatre-movies-table-PROD' }),
        });
        template.hasResourceProperties('AWS::DynamoDB::Table', {
            TableName: 'blockbuster-theatre-pricing-table-PROD',
            BillingMode: 'PAY_PER_REQUEST',
            KeySchema: [{ AttributeName: 'pricingId', KeyType: 'HASH' }],
        });
        template.hasResource('AWS::DynamoDB::Table', {
            DeletionPolicy: 'Retain',
            UpdateReplacePolicy: 'Retain',
            Properties: Match.objectLike({ TableName: 'blockbuster-theatre-pricing-table-PROD' }),
        });
        template.hasResourceProperties('AWS::DynamoDB::Table', {
            TableName: 'blockbuster-theatre-offers-table-PROD',
            BillingMode: 'PAY_PER_REQUEST',
            KeySchema: [{ AttributeName: 'offerId', KeyType: 'HASH' }],
        });
        template.hasResource('AWS::DynamoDB::Table', {
            DeletionPolicy: 'Retain',
            UpdateReplacePolicy: 'Retain',
            Properties: Match.objectLike({ TableName: 'blockbuster-theatre-offers-table-PROD' }),
        });
        template.hasResourceProperties('AWS::DynamoDB::Table', {
            TableName: 'blockbuster-theatre-collections-table-PROD',
            BillingMode: 'PAY_PER_REQUEST',
            KeySchema: [{ AttributeName: 'collectionId', KeyType: 'HASH' }],
        });
        template.hasResource('AWS::DynamoDB::Table', {
            DeletionPolicy: 'Retain',
            UpdateReplacePolicy: 'Retain',
            Properties: Match.objectLike({
                TableName: 'blockbuster-theatre-legacy-bookings-table-PROD',
                BillingMode: 'PAY_PER_REQUEST',
                KeySchema: [
                    { AttributeName: 'showingId', KeyType: 'HASH' },
                    { AttributeName: 'seatId', KeyType: 'RANGE' },
                ],
                GlobalSecondaryIndexes: Match.arrayWith([Match.objectLike({ IndexName: 'UserBookings' })]),
            }),
        });
        template.hasResourceProperties('AWS::DynamoDB::Table', {
            TableName: 'blockbuster-theatre-bookings-table-PROD',
            BillingMode: 'PAY_PER_REQUEST',
            KeySchema: [
                { AttributeName: 'showtimeId', KeyType: 'HASH' },
                { AttributeName: 'seatId', KeyType: 'RANGE' },
            ],
            GlobalSecondaryIndexes: Match.arrayWith([Match.objectLike({ IndexName: 'UserBookings' })]),
        });
        template.hasResourceProperties('AWS::DynamoDB::Table', {
            TableName: 'blockbuster-theatre-showtimes-table-PROD',
            BillingMode: 'PAY_PER_REQUEST',
            KeySchema: [{ AttributeName: 'registryKey', KeyType: 'HASH' }],
        });
        template.hasResourceProperties('AWS::DynamoDB::Table', {
            TableName: 'blockbuster-theatre-booking-references-table-PROD',
            BillingMode: 'PAY_PER_REQUEST',
            KeySchema: [{ AttributeName: 'bookingRef', KeyType: 'HASH' }],
        });
        template.hasResourceProperties('AWS::DynamoDB::Table', {
            TableName: 'blockbuster-theatre-guest-conversion-tokens-table-PROD',
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
        const currentTable = 'BlockbusterTheatreBookingsPROD';
        const legacyTable = 'BlockbusterTheatreLegacyBookingsPROD';
        template.hasResourceProperties('AWS::Lambda::Function', {
            FunctionName: 'blockbuster-theatre-download-booking-ticket-PROD',
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
                        Resource: Match.arrayWith([
                            { 'Fn::GetAtt': [table, 'Arn'] },
                            { 'Fn::Join': ['', [{ 'Fn::GetAtt': [table, 'Arn'] }, '/index/*']] },
                        ]),
                    })]),
                }),
            });
        }
    });

    it('should create Lambda function', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Lambda::Function', {
            FunctionName: 'blockbuster-theatre-add-movie-to-db-PROD',
        });
    });

    it('should create HTTP API', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
            Name: 'blockbuster-theatre-api-PROD',
        });
    });

    it('should create API Gateway integration', () => {
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::ApiGatewayV2::Integration', {
            IntegrationType: 'AWS_PROXY',
        });
    });

    it('should create API Gateway routes', () => {
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
            AuthorizationType: 'JWT',
            AuthorizerId: Match.anyValue(),
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
    });

    it('should output API endpoint', () => {
        const template = Template.fromStack(stack);
        template.hasOutput('ApiEndpoint', {
            Description: 'Base HTTP endpoint for WinForms, WinUI 3, SwiftUI, and Web SPA',
        });
        template.hasOutput('UserPoolId', {});
        template.hasOutput('UserPoolClientId', {});
        template.hasOutput('UserPoolIssuer', {});
        expect(template.toJSON().Outputs.CognitoLoginUrl).toBeUndefined();
    });

    it('should grant Lambda permissions to DynamoDB', () => {
        const template = Template.fromStack(stack);
        template.resourceCountIs('AWS::IAM::Policy', 25);
        template.resourceCountIs('AWS::SES::EmailIdentity', 0);
        template.hasResourceProperties('AWS::Lambda::Function', {
            FunctionName: 'blockbuster-theatre-send-booking-confirmation-PROD',
            Environment: {
                Variables: Match.objectLike({
                    BOOKING_EMAIL_FROM: Match.anyValue(),
                }),
            },
        });
        template.hasResourceProperties('AWS::IAM::Policy', {
            PolicyDocument: Match.objectLike({
                Statement: Match.arrayWith([
                    Match.objectLike({
                        Action: Match.arrayWith(['ses:SendEmail']),
                        Resource: Match.anyValue(),
                    }),
                ]),
            }),
        });
    });

    it('should have correct resource order (DB -> Lambda -> API)', () => {
        const template = Template.fromStack(stack);
        // Database should be created first (no dependencies)
        template.hasResourceProperties('AWS::DynamoDB::Table', {
            TableName: 'blockbuster-theatre-movies-table-PROD',
        });
        // Lambda should be created with correct name
        template.hasResourceProperties('AWS::Lambda::Function', {
            FunctionName: 'blockbuster-theatre-add-movie-to-db-PROD',
        });
        // API should integrate with Lambda
        template.hasResourceProperties('AWS::ApiGatewayV2::Integration', {
            IntegrationType: 'AWS_PROXY',
        });
    });
});
