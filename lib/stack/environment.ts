export const ENVIRONMENT_NAMES = ['prod', 'dev'] as const;

export type EnvironmentName = (typeof ENVIRONMENT_NAMES)[number];

export function parseEnvironmentName(value: unknown): EnvironmentName {
    const envName = value ?? 'prod';
    if (envName !== 'prod' && envName !== 'dev') {
        throw new Error(`Unsupported CDK environment "${String(envName)}"; expected "prod" or "dev".`);
    }
    return envName;
}

export function resourceName(baseName: string, envName: EnvironmentName): string {
    return envName === 'prod' ? baseName : `${baseName}-dev`;
}

export function maxTicketsParameterForEnvironment(
    baseName: string,
    envName: EnvironmentName
): string {
    return resourceName(baseName, envName);
}
