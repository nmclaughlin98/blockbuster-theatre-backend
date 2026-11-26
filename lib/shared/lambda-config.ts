import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import type { LambdaProfileConfig, MovieImportLambdaConfig } from './interfaces';

export const lambdaSettings = {
    base: {
        architecture: lambda.Architecture.ARM_64,
        runtime: lambda.Runtime.NODEJS_24_X,
    },
    standard: { memorySize: 256, timeoutSeconds: 15 },
    heavy: { memorySize: 512, timeoutSeconds: 25 },
    scheduled: { memorySize: 512, timeoutSeconds: 900 },
} as const;

export function getProfileProps(config: LambdaProfileConfig) {
    return {
        memorySize: config.memorySize,
        timeout: cdk.Duration.seconds(config.timeoutSeconds),
        ...(config.reservedConcurrentExecutions !== undefined && {
            reservedConcurrentExecutions: config.reservedConcurrentExecutions,
        }),
    };
}

export const movieImportLambdaConfig: MovieImportLambdaConfig = {
    memorySize: lambdaSettings.heavy.memorySize,
    timeoutSeconds: lambdaSettings.heavy.timeoutSeconds,
    maxBatch: 100,
    tmdbConcurrency: 5,
    tmdbTimeoutMs: 4000,
    tmdbRetries: 3,
};

export const movieUpdateMaxBatch = 25;
export const maxTicketsParameterName = '/blockbuster-theatre/booking-configuration/max-tickets-value';