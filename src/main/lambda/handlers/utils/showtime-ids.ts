import { randomInt } from 'crypto';
import {
    DynamoDBDocumentClient,
    GetCommand,
    TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from '../dynamodb-client';
import type { MovieShowtimes, ScreenedShowtime } from '../interfaces';

const DAYS = [
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
    'Sunday',
] as const;
const SHOWTIME_ID_PATTERN = /^(\d{6})_(\d{4}-\d{2}-\d{2})_((?:[01]\d|2[0-3])[0-5]\d)$/;
const docClient = DynamoDBDocumentClient.from(createDynamoDBClient());

export interface ShowtimeIdentity {
    showtimeId: string;
    movieId: string;
    date: string;
    day: (typeof DAYS)[number];
    screen: ScreenedShowtime['screen'];
    time: string;
}

type RegistryRecord = ShowtimeIdentity & {
    registryKey: string;
    recordType: 'SHOWTIME';
};

export class ShowtimeIdError extends Error {
    constructor(
        public readonly statusCode: number,
        message: string
    ) {
        super(message);
        this.name = 'ShowtimeIdError';
    }
}

function registryTableName(): string {
    const tableName = process.env.SHOWTIME_REGISTRY_TABLE_NAME;
    if (!tableName) throw new Error('SHOWTIME_REGISTRY_TABLE_NAME is not configured.');
    return tableName;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseCalendarDate(value: unknown): string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new ShowtimeIdError(400, 'date must be a valid calendar date in YYYY-MM-DD format.');
    }
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (
        Number.isNaN(parsed.getTime()) ||
        parsed.toISOString().slice(0, 10) !== value
    ) {
        throw new ShowtimeIdError(400, 'date must be a valid calendar date in YYYY-MM-DD format.');
    }
    const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/London',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());
    if (value < today) throw new ShowtimeIdError(400, 'date must not be in the past.');
    return value;
}

function weekdayForDate(date: string): (typeof DAYS)[number] {
    const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    return DAYS[(weekday + 6) % 7];
}

function nextOccurrenceDate(day: string): string {
    const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/London',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());
    const todayDate = new Date(`${today}T00:00:00.000Z`);
    const daysUntil = (DAYS.indexOf(day as (typeof DAYS)[number]) -
        ((todayDate.getUTCDay() + 6) % 7) +
        7) %
        7;
    todayDate.setUTCDate(todayDate.getUTCDate() + daysUntil);
    return todayDate.toISOString().slice(0, 10);
}

function isRegistryRecord(value: unknown): value is RegistryRecord {
    if (!isRecord(value)) return false;
    return (
        value.recordType === 'SHOWTIME' &&
        typeof value.registryKey === 'string' &&
        typeof value.showtimeId === 'string' &&
        typeof value.movieId === 'string' &&
        typeof value.date === 'string' &&
        typeof value.day === 'string' &&
        DAYS.includes(value.day as (typeof DAYS)[number]) &&
        typeof value.screen === 'string' &&
        /^[1-5]$/.test(value.screen) &&
        typeof value.time === 'string' &&
        /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.time)
    );
}

async function getRegistryItem(registryKey: string): Promise<Record<string, unknown> | undefined> {
    const result = await docClient.send(
        new GetCommand({
            TableName: registryTableName(),
            Key: { registryKey },
            ConsistentRead: true,
        })
    );
    return isRecord(result.Item) ? result.Item : undefined;
}

function scheduleKey(
    movieId: string,
    date: string,
    screen: string,
    time: string
): string {
    return `SCHEDULE#${movieId}#${date}#${screen}#${time}`;
}

export async function createShowtimeId(
    movieId: string,
    day: string,
    dateValue: string,
    showtime: Pick<ScreenedShowtime, 'screen' | 'time'>
): Promise<string> {
    const date = parseCalendarDate(dateValue);
    if (!DAYS.includes(day as (typeof DAYS)[number]) || weekdayForDate(date) !== day) {
        throw new ShowtimeIdError(400, `date ${date} does not match ${day}.`);
    }
    if (
        !/^\d+$/.test(movieId) ||
        !['1', '2', '3', '4', '5'].includes(showtime.screen) ||
        !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(showtime.time)
    ) {
        throw new ShowtimeIdError(400, 'Movie or screening details are invalid.');
    }
    const key = scheduleKey(movieId, date, showtime.screen, showtime.time);
    const existing = await getRegistryItem(key);
    if (existing) {
        if (
            existing.recordType !== 'SCHEDULE' ||
            typeof existing.showtimeId !== 'string' ||
            !SHOWTIME_ID_PATTERN.test(existing.showtimeId)
        ) {
            throw new Error('DynamoDB returned an invalid showtime schedule mapping.');
        }
        return existing.showtimeId;
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
        const showtimeId = `${randomInt(100000, 1000000)}_${date}_${showtime.time.replace(':', '')}`;
        const identity = {
            showtimeId,
            movieId,
            date,
            day,
            screen: showtime.screen,
            time: showtime.time,
        };
        try {
            await docClient.send(
                new TransactWriteCommand({
                    TransactItems: [
                        {
                            Put: {
                                TableName: registryTableName(),
                                Item: {
                                    registryKey: key,
                                    recordType: 'SCHEDULE',
                                    showtimeId,
                                },
                                ConditionExpression: 'attribute_not_exists(registryKey)',
                            },
                        },
                        {
                            Put: {
                                TableName: registryTableName(),
                                Item: {
                                    registryKey: `SHOWTIME#${showtimeId}`,
                                    recordType: 'SHOWTIME',
                                    ...identity,
                                },
                                ConditionExpression: 'attribute_not_exists(registryKey)',
                            },
                        },
                    ],
                })
            );
            return showtimeId;
        } catch (error: unknown) {
            if (!(error instanceof Error) || error.name !== 'TransactionCanceledException') {
                throw error;
            }
            const winner = await getRegistryItem(key);
            if (winner) {
                if (
                    winner.recordType !== 'SCHEDULE' ||
                    typeof winner.showtimeId !== 'string' ||
                    !SHOWTIME_ID_PATTERN.test(winner.showtimeId)
                ) {
                    throw new Error('DynamoDB returned an invalid showtime schedule mapping.');
                }
                return winner.showtimeId;
            }
        }
    }
    throw new Error('Unable to allocate a unique showtime ID after multiple attempts.');
}

export function parseShowtimeId(value: unknown): {
    showtimeId: string;
    date: string;
    time: string;
} | undefined {
    if (typeof value !== 'string') return undefined;
    const match = SHOWTIME_ID_PATTERN.exec(value);
    if (!match) return undefined;
    try {
        parseCalendarDate(match[2]);
    } catch {
        return undefined;
    }
    return {
        showtimeId: value,
        date: match[2],
        time: `${match[3].slice(0, 2)}:${match[3].slice(2)}`,
    };
}

export async function resolveShowtimeId(value: unknown): Promise<ShowtimeIdentity> {
    const parsed = parseShowtimeId(value);
    if (!parsed) throw new ShowtimeIdError(400, 'showtimeId is invalid.');
    const item = await getRegistryItem(`SHOWTIME#${parsed.showtimeId}`);
    if (!item) throw new ShowtimeIdError(404, 'Showtime not found.');
    if (!isRegistryRecord(item)) throw new Error('DynamoDB returned an invalid showtime record.');
    if (
        item.registryKey !== `SHOWTIME#${parsed.showtimeId}` ||
        item.showtimeId !== parsed.showtimeId ||
        item.date !== parsed.date ||
        item.time !== parsed.time
    ) {
        throw new Error('DynamoDB showtime identity does not match its ID.');
    }
    return item;
}

export async function addShowtimeIds(
    movieId: string,
    showtimes: MovieShowtimes,
    requestedDate?: string
): Promise<MovieShowtimes> {
    const date = requestedDate === undefined ? undefined : parseCalendarDate(requestedDate);
    const result: MovieShowtimes = {};
    for (const [day, screenings] of Object.entries(showtimes)) {
        const occurrenceDate = date ?? nextOccurrenceDate(day);
        if (weekdayForDate(occurrenceDate) !== day) continue;
        result[day] = await Promise.all(
            screenings.map(async (screening) => ({
                ...screening,
                date: occurrenceDate,
                showtimeId: await createShowtimeId(
                    movieId,
                    day,
                    occurrenceDate,
                    screening
                ),
            }))
        );
    }
    return result;
}
