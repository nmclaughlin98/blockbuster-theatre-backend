import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import {
    authenticateOptional,
    InvalidAuthorizationError,
    json,
    jsonResponseByteLength,
} from '../../../main/lambda/handlers/utils/common';

describe('optional Cognito authentication', () => {
    const userPoolId = 'eu-west-2_testpool';
    const issuer = `https://cognito-idp.eu-west-2.amazonaws.com/${userPoolId}`;
    const clientId = 'test-client';
    const postmanClientId = 'test-postman-client';
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    let testVerifier: ReturnType<typeof CognitoJwtVerifier.create>;
    const originalEnv = {
        USER_POOL_ID: process.env.USER_POOL_ID,
        USER_POOL_CLIENT_ID: process.env.USER_POOL_CLIENT_ID,
        POSTMAN_CLIENT_ID: process.env.POSTMAN_CLIENT_ID,
    };

    function token(overrides: Record<string, unknown> = {}, key: KeyObject = privateKey): string {
        const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url');
        const payload = Buffer.from(JSON.stringify({
            iss: issuer,
            sub: 'verified-user',
            token_use: 'id',
            aud: clientId,
            exp: Math.floor(Date.now() / 1000) + 3600,
            email: '  User@Example.com ',
            email_verified: true,
            ...overrides,
        })).toString('base64url');
        const message = `${header}.${payload}`;
        return `${message}.${sign('RSA-SHA256', Buffer.from(message), key).toString('base64url')}`;
    }

    beforeAll(() => {
        process.env.USER_POOL_ID = userPoolId;
        process.env.USER_POOL_CLIENT_ID = clientId;
        process.env.POSTMAN_CLIENT_ID = postmanClientId;
        testVerifier = CognitoJwtVerifier.create({
            userPoolId,
            clientId: [clientId, postmanClientId],
            tokenUse: null,
        });
        const jwk = publicKey.export({ format: 'jwk' });
        if (!jwk.n || !jwk.e) throw new Error('Expected an RSA public key.');
        testVerifier.cacheJwks({ keys: [{ kty: 'RSA', kid: 'test-key', n: jwk.n, e: jwk.e, use: 'sig', alg: 'RS256' }] }, userPoolId);
        jest.spyOn(CognitoJwtVerifier, 'create').mockReturnValue(testVerifier);
    });

    afterAll(() => {
        jest.restoreAllMocks();
        for (const [name, value] of Object.entries(originalEnv)) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        }
    });

    it('authenticates signed ID tokens and normalizes verified email', async () => {
        await expect(authenticateOptional({ Authorization: `Bearer ${token()}` }))
            .resolves.toEqual({ userId: 'verified-user', verifiedEmail: 'user@example.com' });
        expect(CognitoJwtVerifier.create).toHaveBeenCalledWith({
            userPoolId,
            clientId: [clientId, postmanClientId],
            tokenUse: null,
        });
    });

    it('does not trust email on access tokens or unverified ID tokens', async () => {
        await expect(authenticateOptional({
            authorization: token({ token_use: 'access', client_id: postmanClientId }),
        })).resolves.toEqual({ userId: 'verified-user' });
        await expect(authenticateOptional({ authorization: token({ email_verified: false }) }))
            .resolves.toEqual({ userId: 'verified-user' });
    });

    it('allows requests without credentials but rejects malformed or duplicated headers', async () => {
        await expect(authenticateOptional({})).resolves.toBeUndefined();
        await expect(authenticateOptional({ authorization: 'Bearer' })).rejects.toBeInstanceOf(InvalidAuthorizationError);
        await expect(authenticateOptional({ authorization: token(), Authorization: token() }))
            .rejects.toBeInstanceOf(InvalidAuthorizationError);
    });

    it.each([
        ['invalid signature', () => token({}, otherKey)],
        ['expired token', () => token({ exp: Math.floor(Date.now() / 1000) - 60 })],
        ['wrong client', () => token({ aud: 'other-client' })],
        ['wrong issuer', () => token({ iss: 'https://example.com' })],
        ['missing issuer', () => token({ iss: undefined })],
        ['missing subject', () => token({ sub: '' })],
        ['invalid token use', () => token({ token_use: 'refresh' })],
    ])('rejects a signed token with %s', async (_name, makeToken) => {
        await expect(authenticateOptional({ authorization: makeToken() }))
            .rejects.toBeInstanceOf(InvalidAuthorizationError);
    });

    it('propagates verification infrastructure failures instead of treating them as invalid credentials', async () => {
        const failure = new Error('JWKS unavailable');
        const verify = jest.spyOn(testVerifier, 'verify').mockRejectedValueOnce(failure);
        await expect(authenticateOptional({ authorization: token() })).rejects.toBe(failure);
        verify.mockRestore();
    });
});

describe('shared JSON responses', () => {
    afterEach(() => jest.restoreAllMocks());

    it.each([
        { statusCode: 200, level: 'INFO' as const, method: 'log' as const },
        { statusCode: 400, level: 'WARN' as const, method: 'warn' as const },
        { statusCode: 500, level: 'ERROR' as const, method: 'error' as const },
    ])('logs a $level response with its status code', ({ statusCode, level, method }) => {
        const logger = jest.spyOn(console, method).mockImplementation(() => { });
        const response = json(statusCode, { message: 'do not include response data' });

        expect(response.statusCode).toBe(statusCode);
        expect(JSON.parse(String(logger.mock.calls[0][0]))).toMatchObject({
            level,
            message: 'API response completed.',
            statusCode,
        });
        expect(String(logger.mock.calls[0][0])).not.toContain('do not include response data');
    });

    it('measures the escaped proxy response in bytes without logging a response', () => {
        const logger = jest.spyOn(console, 'log').mockImplementation(() => {});
        const body = { message: 'A "quoted" caf\u00e9' };
        const size = jsonResponseByteLength(200, body);
        expect(logger).not.toHaveBeenCalled();
        expect(size).toBe(Buffer.byteLength(JSON.stringify(json(200, body)), 'utf8'));
        logger.mockRestore();
    });
});
