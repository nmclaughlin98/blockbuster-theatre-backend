import type { LambdaProfileConfig } from './lambda-profile-config';

export interface MovieImportLambdaConfig extends LambdaProfileConfig {
    maxBatch: number;
    tmdbConcurrency: number;
    tmdbTimeoutMs: number;
    tmdbRetries: number;
}
