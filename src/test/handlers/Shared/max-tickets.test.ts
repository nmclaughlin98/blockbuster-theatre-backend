import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { sdkStreamMixin } from '@smithy/util-stream';
import { Readable } from 'node:stream';
import { mockClient } from 'aws-sdk-client-mock';
import { getMaxTickets } from '../../../main/lambda/handlers/Shared/max-tickets-service';
import { getRuntimeConfig } from '../../../main/lambda/handlers/Shared/runtime-config';

const s3Mock = mockClient(S3Client);
const originalBucketName = process.env.CONFIG_BUCKET_NAME;
const originalConfigKey = process.env.CONFIG_KEY;
let testNumber = 0;

function configBody(value: unknown) {
    return sdkStreamMixin(Readable.from([JSON.stringify(value)]));
}

function configureS3(value: unknown): void {
    s3Mock.on(GetObjectCommand).resolves({ Body: configBody(value) });
}

describe('runtime configuration', () => {
    beforeEach(() => {
        s3Mock.reset();
        process.env.CONFIG_BUCKET_NAME = 'runtime-config-test';
        process.env.CONFIG_KEY = `test-config-${++testNumber}.json`;
    });

    afterEach(() => {
        if (originalBucketName === undefined) delete process.env.CONFIG_BUCKET_NAME;
        else process.env.CONFIG_BUCKET_NAME = originalBucketName;

        if (originalConfigKey === undefined) delete process.env.CONFIG_KEY;
        else process.env.CONFIG_KEY = originalConfigKey;

        jest.restoreAllMocks();
        jest.useRealTimers();
    });

    it('uses the configured ticket limit and caches the S3 response', async () => {
        configureS3({
            features: { allowLinkBookings: true },
            limits: { maxTickets: 12 },
        });

        await expect(getMaxTickets()).resolves.toBe(12);
        await expect(getRuntimeConfig()).resolves.toEqual({
            features: { allowLinkBookings: true },
            limits: { maxTickets: 12 },
        });

        expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(1);
    });

    it('refreshes cached configuration after 45 seconds', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
        s3Mock.on(GetObjectCommand)
            .resolvesOnce({ Body: configBody({ limits: { maxTickets: 12 } }) })
            .resolvesOnce({ Body: configBody({ limits: { maxTickets: 6 } }) });

        await expect(getMaxTickets()).resolves.toBe(12);
        jest.advanceTimersByTime(45_001);
        await expect(getMaxTickets()).resolves.toBe(6);
        expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(2);
    });

    it('supports flat legacy keys and defaults invalid values safely', async () => {
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);

        configureS3({ allowLinkBookings: 'yes', maxTickets: 0 });

        await expect(getRuntimeConfig()).resolves.toEqual({
            features: { allowLinkBookings: false },
            limits: { maxTickets: 10 },
        });
    });

    it('uses safe defaults when the S3 object cannot be loaded', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

        s3Mock.on(GetObjectCommand).rejects(new Error('S3 unavailable'));

        await expect(getRuntimeConfig()).resolves.toEqual({
            features: { allowLinkBookings: false },
            limits: { maxTickets: 10 },
        });

        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('uses safe defaults when the configuration bucket is not configured', async () => {
        delete process.env.CONFIG_BUCKET_NAME;

        await expect(getMaxTickets()).resolves.toBe(10);
        expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(0);
    });
});
