export const ENVIRONMENT_NAMES = ['prod', 'dev'] as const;

export type EnvironmentName = (typeof ENVIRONMENT_NAMES)[number];

export function parseEnvironmentName(value: unknown): EnvironmentName {
    const envName = value ?? 'prod';

    if (envName !== 'prod' && envName !== 'dev') {
        throw new Error(`Unsupported CDK environment "${String(envName)}"; expected "prod" or "dev".`);
    }

    return envName;
}

/**
 *
 * @param baseName The base name of the resource.
 * @param envName The environment name (e.g., 'prod' or 'dev').
 * @returns The fully qualified resource name including the environment suffix.
 */
export function resourceName(baseName: string, envName: EnvironmentName): string {
    const projectPrefix = 'blockbuster-theatre';
    const prefixIndex = baseName.indexOf(projectPrefix);

    if (prefixIndex === -1) {
        return `${baseName}-${envName.toUpperCase()}`;
    }

    return `${baseName.slice(0, prefixIndex)}${projectPrefix}-${envName}${baseName.slice(
        prefixIndex + projectPrefix.length,
    )}`;
}

