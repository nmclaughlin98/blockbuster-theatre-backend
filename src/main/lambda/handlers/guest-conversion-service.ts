import {
    AdminCreateUserCommand,
    AdminGetUserCommand,
    AdminInitiateAuthCommand,
    AdminSetUserPasswordCommand,
    CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { createHash } from 'crypto';
import {
    DynamoDBDocumentClient,
    GetCommand,
    TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from './dynamodb-client';

const cognitoClient = new CognitoIdentityProviderClient({
    region: process.env.AWS_REGION ?? 'eu-west-2',
});
const docClient = DynamoDBDocumentClient.from(createDynamoDBClient());
const CONVERSION_TOKEN_PATTERN = /^cnv_tok_[A-Za-z0-9_-]{43}$/;
const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{12,256}$/;

type UnknownRecord = Record<string, unknown>;

export class GuestConversionError extends Error {
    constructor(
        public readonly statusCode: number,
        message: string
    ) {
        super(message);
        this.name = 'GuestConversionError';
    }
}

interface GuestConversionTokenRecord {
    tokenHash: string;
    bookingId: string;
    showingId: string;
    customerEmail: string;
    expiresAt: number;
    consumedAt?: string;
    userId?: string;
}

function isGuestConversionTokenRecord(
    value: unknown
): value is GuestConversionTokenRecord {
    return (
        isRecord(value) &&
        typeof value.tokenHash === 'string' &&
        typeof value.bookingId === 'string' &&
        typeof value.showingId === 'string' &&
        typeof value.customerEmail === 'string' &&
        Number.isSafeInteger(value.expiresAt) &&
        (value.consumedAt === undefined || typeof value.consumedAt === 'string')
    );
}

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredEnvironmentVariable(name: string): string {
    const value = process.env[name];
    if (!value) throw new GuestConversionError(500, `${name} is not configured.`);
    return value;
}

function hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

function parseRequest(value: unknown): { conversionToken: string; password: string } {
    if (
        !isRecord(value) ||
        Object.keys(value).some((key) => !['conversionToken', 'password'].includes(key))
    ) {
        throw new GuestConversionError(
            400,
            'Only conversionToken and password are accepted.'
        );
    }
    if (
        typeof value.conversionToken !== 'string' ||
        !CONVERSION_TOKEN_PATTERN.test(value.conversionToken)
    ) {
        throw new GuestConversionError(400, 'A valid conversionToken is required.');
    }
    if (typeof value.password !== 'string' || !PASSWORD_PATTERN.test(value.password)) {
        throw new GuestConversionError(
            400,
            'Password must be 12-256 characters and include uppercase, lowercase, numeric, and symbol characters.'
        );
    }
    return { conversionToken: value.conversionToken, password: value.password };
}

async function authenticateExistingUser(
    userPoolId: string,
    clientId: string,
    email: string,
    password: string
): Promise<{ userId?: string; accessToken: string; refreshToken: string }> {
    let response;
    try {
        response = await cognitoClient.send(
            new AdminInitiateAuthCommand({
                UserPoolId: userPoolId,
                ClientId: clientId,
                AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
                AuthParameters: { USERNAME: email, PASSWORD: password },
            })
        );
    } catch (error: unknown) {
        if (
            error instanceof Error &&
            (error.name === 'NotAuthorizedException' || error.name === 'UserNotFoundException')
        ) {
            throw new GuestConversionError(409, 'An account already exists for this email.');
        }
        throw error;
    }
    const authentication = response.AuthenticationResult;
    if (!authentication?.AccessToken || !authentication.RefreshToken) {
        throw new GuestConversionError(500, 'Cognito did not return a complete token set.');
    }
    const user = await cognitoClient.send(
        new AdminGetUserCommand({ UserPoolId: userPoolId, Username: email })
    );
    return {
        userId: user.UserAttributes?.find((attribute) => attribute.Name === 'sub')?.Value,
        accessToken: authentication.AccessToken,
        refreshToken: authentication.RefreshToken,
    };
}

export async function convertGuestAccount(value: unknown): Promise<{
    userId: string;
    email: string;
    accessToken: string;
    refreshToken: string;
}> {
    const request = parseRequest(value);
    const tokenHash = hashToken(request.conversionToken);
    const tokensTableName = requiredEnvironmentVariable('GUEST_CONVERSION_TOKENS_TABLE_NAME');
    const bookingsTableName = requiredEnvironmentVariable('BOOKINGS_TABLE_NAME');
    const userPoolId = requiredEnvironmentVariable('USER_POOL_ID');
    const clientId = requiredEnvironmentVariable('USER_POOL_CLIENT_ID');

    const tokenResult = await docClient.send(
        new GetCommand({
            TableName: tokensTableName,
            Key: { tokenHash },
            ConsistentRead: true,
        })
    );
    if (!tokenResult.Item) {
        throw new GuestConversionError(404, 'Guest conversion token is invalid.');
    }
    if (!isGuestConversionTokenRecord(tokenResult.Item)) {
        throw new Error('DynamoDB returned an invalid guest conversion token record.');
    }
    const tokenRecord = tokenResult.Item;
    if (tokenRecord.consumedAt) {
        throw new GuestConversionError(409, 'Guest conversion token has already been used.');
    }
    const now = Math.floor(Date.now() / 1000);
    if (tokenRecord.expiresAt <= now) {
        throw new GuestConversionError(410, 'Guest conversion token has expired.');
    }

    const bookingKey = {
        showingId: tokenRecord.showingId,
        seatId: `BOOKING#${tokenRecord.bookingId}`,
    };
    const bookingResult = await docClient.send(
        new GetCommand({
            TableName: bookingsTableName,
            Key: bookingKey,
            ConsistentRead: true,
        })
    );
    const booking = bookingResult.Item;
    if (
        !booking ||
        booking.recordType !== 'BOOKING' ||
        booking.customerEmail !== tokenRecord.customerEmail
    ) {
        throw new GuestConversionError(410, 'Guest booking for this token is unavailable.');
    }

    let createdUserId: string | undefined;
    let auth: { accessToken: string; refreshToken: string };
    try {
        const created = await cognitoClient.send(
            new AdminCreateUserCommand({
                UserPoolId: userPoolId,
                Username: tokenRecord.customerEmail,
                MessageAction: 'SUPPRESS',
                UserAttributes: [
                    { Name: 'email', Value: tokenRecord.customerEmail },
                ],
            })
        );
        createdUserId = created.User?.Attributes?.find((attribute) => attribute.Name === 'sub')?.Value;
        if (!createdUserId) {
            throw new GuestConversionError(500, 'Cognito did not return the new user ID.');
        }
        await cognitoClient.send(
            new AdminSetUserPasswordCommand({
                UserPoolId: userPoolId,
                Username: tokenRecord.customerEmail,
                Password: request.password,
                Permanent: true,
            })
        );
        auth = await authenticateExistingUser(
            userPoolId,
            clientId,
            tokenRecord.customerEmail,
            request.password
        );
    } catch (error: unknown) {
        if (error instanceof Error && error.name === 'UsernameExistsException') {
            auth = await authenticateExistingUser(
                userPoolId,
                clientId,
                tokenRecord.customerEmail,
                request.password
            );
        } else if (
            error instanceof Error &&
            (error.name === 'InvalidPasswordException' ||
                error.name === 'PasswordHistoryPolicyViolationException')
        ) {
            throw new GuestConversionError(400, 'Password does not meet the account policy.');
        } else {
            throw error;
        }
    }

    const userId = createdUserId ?? auth.userId;
    if (!userId) {
        throw new GuestConversionError(
            500,
            'Unable to resolve the account ID for the converted guest.'
        );
    }

    try {
        await docClient.send(
            new TransactWriteCommand({
                TransactItems: [
                    {
                        Update: {
                            TableName: tokensTableName,
                            Key: { tokenHash },
                            UpdateExpression: 'SET consumedAt = :consumedAt, userId = :userId',
                            ConditionExpression:
                                'attribute_not_exists(consumedAt) AND expiresAt > :now',
                            ExpressionAttributeValues: {
                                ':consumedAt': new Date().toISOString(),
                                ':userId': userId,
                                ':now': now,
                            },
                        },
                    },
                    {
                        Update: {
                            TableName: bookingsTableName,
                            Key: bookingKey,
                            UpdateExpression: 'SET userId = :userId',
                            ConditionExpression:
                                'recordType = :booking AND customerEmail = :email',
                            ExpressionAttributeValues: {
                                ':userId': userId,
                                ':booking': 'BOOKING',
                                ':email': tokenRecord.customerEmail,
                            },
                        },
                    },
                ],
            })
        );
    } catch (error: unknown) {
        if (
            error instanceof Error &&
            error.name === 'TransactionCanceledException' &&
            (error as { CancellationReasons?: Array<{ Code?: string }> })
                .CancellationReasons?.some(
                    (reason) => reason.Code === 'ConditionalCheckFailed'
                )
        ) {
            throw new GuestConversionError(409, 'Guest conversion token has already been used or expired.');
        }
        throw error;
    }

    return {
        userId,
        email: tokenRecord.customerEmail,
        accessToken: auth.accessToken,
        refreshToken: auth.refreshToken,
    };
}
