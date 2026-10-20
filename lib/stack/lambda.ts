import * as lambda from 'aws-cdk-lib/aws-lambda';

export const lambdaSettings = {
    runtime: lambda.Runtime.NODEJS_24_X,
    default: { memorySize: 256, timeoutSeconds: 10 },
    batchProcessing: { memorySize: 256, timeoutSeconds: 15 },
    collectionTreeRead: { memorySize: 256, timeoutSeconds: 25 },
    collectionRefresh: { memorySize: 512, timeoutSeconds: 25 },
    fullTableExport: { memorySize: 512, timeoutSeconds: 25 },
    fullTableRead: { memorySize: 256, timeoutSeconds: 25 },
    paginatedSelectionRead: { memorySize: 256, timeoutSeconds: 15 },
} as const;

export interface MovieImportLambdaConfig {
    memorySize: number;
    timeoutSeconds: number;
    reservedConcurrentExecutions?: number;
    maxBatch: number;
    tmdbConcurrency: number;
    tmdbTimeoutMs: number;
    tmdbRetries: number;
}

export const movieImportLambdaConfig: MovieImportLambdaConfig = {
    memorySize: 512,
    timeoutSeconds: 25,
    maxBatch: 100,
    tmdbConcurrency: 5,
    tmdbTimeoutMs: 4000,
    tmdbRetries: 3,
};

export const movieUpdateMaxBatch = 25;