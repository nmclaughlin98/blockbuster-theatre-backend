import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { log } from '../utils/common';

export interface RuntimeConfig {
    features: {
        allowLinkBookings: boolean;
    };
    limits: {
        maxTickets: number;
    };
}

const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
    features: { allowLinkBookings: false },
    limits: { maxTickets: 10 },
};

const CACHE_TTL_MS = 45_000;
const s3Client = new S3Client({ region: process.env.AWS_REGION ?? 'eu-west-2' });

let cached: {
    bucket: string;
    key: string;
    expiresAt: number;
    config: RuntimeConfig;
} | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidMaxTickets(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function parseRuntimeConfig(value: unknown): RuntimeConfig {
    if (!isRecord(value)) {
        log('WARN', 'Runtime config must be a JSON object; using safe defaults.');

        return DEFAULT_RUNTIME_CONFIG;
    }

    const root = value;
    const features = isRecord(root.features) ? root.features : {};
    const limits = isRecord(root.limits) ? root.limits : {};
    const allowLinkBookings = features.allowLinkBookings ?? root.allowLinkBookings;
    const maxTickets = limits.maxTickets ?? root.maxTickets;

    if (allowLinkBookings !== undefined && typeof allowLinkBookings !== 'boolean') {
        log('WARN', 'Invalid runtime config setting; using safe default.', {
            setting: 'features.allowLinkBookings',
        });
    }

    if (maxTickets !== undefined && !isValidMaxTickets(maxTickets)) {
        log('WARN', 'Invalid runtime config setting; using safe default.', {
            setting: 'limits.maxTickets',
        });
    }

    return {
        features: {
            allowLinkBookings: typeof allowLinkBookings === 'boolean'
                ? allowLinkBookings
                : DEFAULT_RUNTIME_CONFIG.features.allowLinkBookings,
        },
        limits: {
            maxTickets: isValidMaxTickets(maxTickets)
                ? maxTickets
                : DEFAULT_RUNTIME_CONFIG.limits.maxTickets,
        },
    };
}

function cacheConfig(bucket: string, key: string, config: RuntimeConfig): RuntimeConfig {
    cached = {
        bucket,
        key,
        config,
        expiresAt: Date.now() + CACHE_TTL_MS,
    };

    return config;
}

export async function getRuntimeConfig(): Promise<RuntimeConfig> {
    const bucket = process.env.CONFIG_BUCKET_NAME?.trim() ?? '';
    const key = process.env.CONFIG_KEY?.trim() || 'blockbuster-theatre/prod/config.json';
    const now = Date.now();

    if (cached?.bucket === bucket && cached.key === key && cached.expiresAt > now) {
        return cached.config;
    }

    if (!bucket) {
        log('WARN', 'Runtime config bucket is not configured; using safe defaults.', { configKey: key });

        return cacheConfig(bucket, key, DEFAULT_RUNTIME_CONFIG);
    }

    try {
        const response = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));

        if (!response.Body) throw new Error('Runtime config object has no body.');

        const rawConfig = await response.Body.transformToString();
        const config = parseRuntimeConfig(JSON.parse(rawConfig));

        return cacheConfig(bucket, key, config);
    } catch (error: unknown) {
        log('WARN', 'Failed to load runtime config from S3; using safe defaults.', {
            bucket,
            configKey: key,
            error: error instanceof Error ? error.message : 'Unknown error',
        });

        return cacheConfig(bucket, key, DEFAULT_RUNTIME_CONFIG);
    }
}
