import { getRuntimeConfig } from './runtime-config';

export async function getMaxTickets(): Promise<number> {
    return (await getRuntimeConfig()).limits.maxTickets;
}
