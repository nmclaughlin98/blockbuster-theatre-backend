export interface LambdaProfileConfig {
    memorySize: number;
    timeoutSeconds: number;
    reservedConcurrentExecutions?: number;
}
