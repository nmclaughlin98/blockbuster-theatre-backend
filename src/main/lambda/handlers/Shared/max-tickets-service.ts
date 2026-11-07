import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { log } from '../utils/common';

const DEFAULT_MAX_TICKETS = 10;
const ssmClient = new SSMClient({
    region: process.env.AWS_REGION ?? 'eu-west-2',
});

function logMaxTickets(maxTickets: number, source: 'parameter' | 'default', parameterName?: string): void {
    log('INFO', 'Maximum ticket limit resolved.', {
        maxTickets,
        source,
        ...(parameterName && { parameterName }),
    });
}

function isParameterNotFound(error: unknown): boolean {
    return typeof error === 'object'
        && error !== null
        && 'name' in error
        && error.name === 'ParameterNotFound';
}

export async function getMaxTickets(): Promise<number> {
    const parameterName = process.env.MAX_TICKETS_PARAMETER_NAME;
    if (!parameterName) {
        logMaxTickets(DEFAULT_MAX_TICKETS, 'default');
        return DEFAULT_MAX_TICKETS;
    }

    try {
        const response = await ssmClient.send(new GetParameterCommand({
            Name: parameterName,
            WithDecryption: false,
        }));
        const value = response.Parameter?.Value;
        const maxTickets = Number(value);
        if (!value || !Number.isSafeInteger(maxTickets) || maxTickets < 1) {
            throw new Error(`SSM parameter ${parameterName} must contain a positive integer.`);
        }
        logMaxTickets(maxTickets, 'parameter', parameterName);

        return maxTickets;
    } catch (error: unknown) {
        if (!isParameterNotFound(error)) throw error;

        log('WARN', 'Maximum ticket limit parameter was not found; using fallback.', {
            parameterName,
            fallback: DEFAULT_MAX_TICKETS,
        });
        logMaxTickets(DEFAULT_MAX_TICKETS, 'default', parameterName);

        return DEFAULT_MAX_TICKETS;
    }
}
