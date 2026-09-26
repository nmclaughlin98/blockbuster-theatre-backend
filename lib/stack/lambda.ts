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
    maxBatch: 25,
    tmdbConcurrency: 5,
    tmdbTimeoutMs: 4000,
    tmdbRetries: 3,
};