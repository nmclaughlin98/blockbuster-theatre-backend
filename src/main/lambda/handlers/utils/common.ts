import type {
    APIGatewayEventRequestContextJWTAuthorizer,
    APIGatewayEventRequestContextV2,
    APIGatewayProxyEventV2WithRequestContext,
    APIGatewayProxyResultV2,
} from 'aws-lambda';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import {
    JwtInvalidClaimError, JwtInvalidSignatureAlgorithmError, JwtInvalidSignatureError,
    JwtParseError, JwtWithoutValidKidError, KidNotFoundInJwksError, ParameterValidationError,
    WaitPeriodNotYetEndedJwkError,
} from 'aws-jwt-verify/error';

export type OptionalJwtEvent = APIGatewayProxyEventV2WithRequestContext<
    APIGatewayEventRequestContextV2 & { authorizer?: APIGatewayEventRequestContextJWTAuthorizer }
>;

export class InvalidAuthorizationError extends Error {
    constructor() {
        super('Invalid authorization token.');
    }
}

let verifier: ReturnType<typeof CognitoJwtVerifier.create> | undefined;

export async function authenticateOptional(
    headers: Record<string, string | undefined>
): Promise<{ userId: string; verifiedEmail?: string } | undefined> {
    const values = Object.entries(headers).filter(([name]) => name.toLowerCase() === 'authorization');
    if (!values.length) return undefined;
    if (values.length !== 1 || typeof values[0][1] !== 'string') throw new InvalidAuthorizationError();
    const value = values[0][1].trim();
    const token = /^Bearer\s+(\S+)$/i.exec(value)?.[1] ?? (/^[^\s]+$/.test(value) ? value : undefined);
    if (!token) throw new InvalidAuthorizationError();
    const userPoolId = process.env.USER_POOL_ID;
    const clientIds = [process.env.USER_POOL_CLIENT_ID, process.env.POSTMAN_CLIENT_ID];
    if (!userPoolId || clientIds.some((id) => !id)) throw new Error('Cognito verification is not configured.');
    verifier ??= CognitoJwtVerifier.create({
        userPoolId,
        clientId: clientIds.filter((id): id is string => Boolean(id)),
        tokenUse: null,
    });
    try {
        const claims = await verifier.verify(token);
        if (typeof claims.sub !== 'string' || !claims.sub.trim()) throw new InvalidAuthorizationError();
        const verifiedEmail = claims.token_use === 'id' && claims.email_verified === true
            && typeof claims.email === 'string' && claims.email.trim()
            ? claims.email.trim().toLowerCase() : undefined;
        return { userId: claims.sub, ...(verifiedEmail && { verifiedEmail }) };
    } catch (error: unknown) {
        if (error instanceof JwtInvalidClaimError || error instanceof JwtInvalidSignatureAlgorithmError
            || error instanceof JwtInvalidSignatureError || error instanceof JwtParseError
            || error instanceof JwtWithoutValidKidError || error instanceof KidNotFoundInJwksError
            || error instanceof WaitPeriodNotYetEndedJwkError
            // The verifier selects an issuer before validating the token's claims.
            || (error instanceof ParameterValidationError
                && (error.message === 'issuer must be provided'
                    || error.message.startsWith('issuer not configured:')))) throw new InvalidAuthorizationError();
        throw error;
    }
}

type LogLevel = 'INFO' | 'WARN' | 'ERROR';

const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'OPTIONS,GET,POST,PATCH',
};

/**
 * Reads a positive integer from an environment variable.
 * @param name Environment variable name.
 * @param fallback Value to use when the variable is unset.
 * @returns The configured integer or fallback.
 * @throws If the configured value is not a positive integer.
 */
export function intEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`Invalid env var ${name}=${raw}`);
    }
    return value;
}

/**
 * Creates an API Gateway JSON response with the shared CORS headers.
 * @param statusCode HTTP response status.
 * @param body Value to serialize as JSON.
 * @returns The API Gateway response.
 */
function jsonResponse(statusCode: number, body: unknown) {
    return { statusCode, headers, body: JSON.stringify(body) };
}

export function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
    const level: LogLevel = statusCode >= 500 ? 'ERROR' : statusCode >= 400 ? 'WARN' : 'INFO';
    log(level, 'API response completed.', { statusCode });
    return jsonResponse(statusCode, body);
}

export function jsonResponseByteLength(statusCode: number, body: unknown): number {
    return Buffer.byteLength(JSON.stringify(jsonResponse(statusCode, body)), 'utf8');
}

/**
 * Waits for the requested duration.
 * @param ms Delay in milliseconds.
 * @returns A promise resolved after the delay.
 */
export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Writes a structured log entry at the requested severity.
 * @param level Log severity.
 * @param message Log message.
 * @param meta Optional fields to include in the log entry.
 */
export function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    const entry = {
        level,
        message,
        timestamp: new Date().toISOString(),
        ...meta,
    };
    const line = JSON.stringify(entry);
    if (level === 'ERROR') {
        console.error(line);
    } else if (level === 'WARN') {
        console.warn(line);
    } else {
        console.log(line);
    }
}

/**
 * Maps items in parallel while preserving result order and limiting concurrency.
 * @param items Items to process.
 * @param limit Maximum number of concurrent operations.
 * @param fn Async operation applied to each item.
 * @returns Results in the same order as the input items.
 */
export async function mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;

    async function worker(): Promise<void> {
        while (true) {
            const index = next++;
            if (index >= items.length) return;
            results[index] = await fn(items[index]);
        }
    }

    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}

/**
 * Trims and deduplicates movie IDs and identifies non-numeric values.
 * @param movieIds Raw values supplied by the caller.
 * @returns Normalized IDs and IDs that are not numeric.
 */
export function normalizeMovieIds(movieIds: unknown[]): { ids: string[]; invalid: string[] } {
    const ids = [...new Set(movieIds.map((raw) => String(raw).trim()).filter(Boolean))];
    return {
        ids,
        invalid: ids.filter((id) => !/^\d+$/.test(id)),
    };
}
