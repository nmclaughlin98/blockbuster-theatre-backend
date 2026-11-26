import { randomInt } from 'crypto';
import {
    DynamoDBDocumentClient,
    GetCommand,
    QueryCommand,
    TransactWriteCommand,
    UpdateCommand,
    type NativeAttributeValue,
} from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from '../Shared/dynamodb-client';
import type { MovieShowtimes, ScreenedShowtime } from '../../lib/interfaces';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
const SHOWTIME_ID_PATTERN = /^(\d{6})_(\d{4}-\d{2}-\d{2})_((?:[01]\d|2[0-3])[0-5]\d)$/;
const docClient = DynamoDBDocumentClient.from(createDynamoDBClient());

export interface ShowtimeIdentity {
    showtimeId: string;
    movieId: string;
    date: string;
    day: (typeof DAYS)[number];
    screen: ScreenedShowtime['screen'];
    time: string;
    source?: 'GENERATED' | 'MANUAL' | 'OFFER';
    status?: 'ACTIVE' | 'CLOSING' | 'CANCELLED';
    runtime?: number;
}

type RegistryRecord = ShowtimeIdentity & {
    registryKey: string;
    recordType: 'SHOWTIME';
    GSI1PK?: string;
    GSI1SK?: string;
};

export class ShowtimeIdError extends Error {
    constructor(
        public readonly statusCode: number,
        message: string,
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

    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
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
    const daysUntil =
        (DAYS.indexOf(day as (typeof DAYS)[number]) - ((todayDate.getUTCDay() + 6) % 7) + 7) % 7;

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
        /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.time) &&
        (value.source === undefined ||
            value.source === 'GENERATED' ||
            value.source === 'MANUAL' ||
            value.source === 'OFFER') &&
        (value.status === undefined ||
            value.status === 'ACTIVE' ||
            value.status === 'CLOSING' ||
            value.status === 'CANCELLED') &&
        (value.runtime === undefined ||
            (typeof value.runtime === 'number' && Number.isFinite(value.runtime) && value.runtime >= 0))
    );
}

async function getRegistryItem(registryKey: string): Promise<Record<string, unknown> | undefined> {
    const result = await docClient.send(
        new GetCommand({
            TableName: registryTableName(),
            Key: { registryKey },
            ConsistentRead: true,
        }),
    );

    return isRecord(result.Item) ? result.Item : undefined;
}

function scheduleKey(movieId: string, date: string, screen: string, time: string): string {
    return `SCHEDULE#${movieId}#${date}#${screen}#${time}`;
}

export async function createShowtimeId(
    movieId: string,
    day: string,
    dateValue: string,
    showtime: Pick<ScreenedShowtime, 'screen' | 'time'>,
    options: { source?: 'GENERATED' | 'MANUAL' | 'OFFER'; runtime?: number } = {},
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

        await ensureShowtimeRecord(existing.showtimeId, { movieId, date, day, ...showtime }, options);

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
                                    movieId,
                                    date,
                                    screen: showtime.screen,
                                    time: showtime.time,
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
                                    GSI1PK: `DATE#${date}`,
                                    GSI1SK: `${showtime.screen}#${showtime.time}#${movieId}#${showtimeId}`,
                                    source: options.source ?? 'GENERATED',
                                    status: 'ACTIVE',
                                    runtime: options.runtime ?? 120,
                                },
                                ConditionExpression: 'attribute_not_exists(registryKey)',
                            },
                        },
                    ],
                }),
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

async function ensureShowtimeRecord(
    showtimeId: string,
    identity: Omit<ShowtimeIdentity, 'showtimeId'>,
    options: { source?: 'GENERATED' | 'MANUAL' | 'OFFER'; runtime?: number },
): Promise<void> {
    const item = await getRegistryItem(`SHOWTIME#${showtimeId}`);

    if (!item) throw new Error(`Showtime ${showtimeId} has no registry identity record.`);

    if (item.recordType !== 'SHOWTIME') {
        throw new Error('DynamoDB returned an invalid showtime registry record.');
    }

    await docClient.send(
        new UpdateCommand({
            TableName: registryTableName(),
            Key: { registryKey: `SHOWTIME#${showtimeId}` },
            UpdateExpression: [
                'SET #movieId = if_not_exists(#movieId, :movieId)',
                '#date = if_not_exists(#date, :date)',
                '#day = if_not_exists(#day, :day)',
                '#screen = if_not_exists(#screen, :screen)',
                '#time = if_not_exists(#time, :time)',
                '#gsi1pk = if_not_exists(#gsi1pk, :gsi1pk)',
                '#gsi1sk = if_not_exists(#gsi1sk, :gsi1sk)',
                '#status = if_not_exists(#status, :active)',
                '#runtime = if_not_exists(#runtime, :runtime)',
                '#source = :source',
            ].join(', '),
            ExpressionAttributeNames: {
                '#movieId': 'movieId',
                '#date': 'date',
                '#day': 'day',
                '#screen': 'screen',
                '#time': 'time',
                '#gsi1pk': 'GSI1PK',
                '#gsi1sk': 'GSI1SK',
                '#status': 'status',
                '#runtime': 'runtime',
                '#source': 'source',
            },
            ExpressionAttributeValues: {
                ':movieId': identity.movieId,
                ':date': identity.date,
                ':day': identity.day,
                ':screen': identity.screen,
                ':time': identity.time,
                ':gsi1pk': `DATE#${identity.date}`,
                ':gsi1sk': `${identity.screen}#${identity.time}#${identity.movieId}#${showtimeId}`,
                ':active': 'ACTIVE',
                ':runtime': options.runtime ?? 120,
                ':source':
                    options.source === 'MANUAL' || options.source === 'OFFER'
                        ? options.source
                        : (item.source ?? 'GENERATED'),
            },
        }),
    );
}

export async function getShowtimeRecord(showtimeId: string): Promise<Record<string, unknown> | undefined> {
    return getRegistryItem(`SHOWTIME#${showtimeId}`);
}

export async function listShowtimesForDate(
    date: string,
): Promise<Array<Record<string, NativeAttributeValue>>> {
    let exclusiveStartKey: Record<string, NativeAttributeValue> | undefined;
    const records: Array<Record<string, NativeAttributeValue>> = [];
    do {
        const result = await docClient.send(
            new QueryCommand({
                TableName: registryTableName(),
                IndexName: 'ShowtimesByDate',
                KeyConditionExpression: 'GSI1PK = :dateKey',
                FilterExpression: 'recordType = :showtime',
                ExpressionAttributeValues: {
                    ':dateKey': `DATE#${date}`,
                    ':showtime': 'SHOWTIME',
                },
                ExclusiveStartKey: exclusiveStartKey,
            }),
        );

        records.push(...(result.Items ?? []));
        exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return records;
}

export async function markShowtimeCancelled(
    showtimeId: string,
    source: 'GENERATED' | 'MANUAL' | 'OFFER' = 'MANUAL',
): Promise<void> {
    await docClient.send(
        new UpdateCommand({
            TableName: registryTableName(),
            Key: { registryKey: `SHOWTIME#${showtimeId}` },
            UpdateExpression: 'SET #status = :cancelled, #source = :source',
            ConditionExpression: 'attribute_exists(registryKey)',
            ExpressionAttributeNames: {
                '#status': 'status',
                '#source': 'source',
            },
            ExpressionAttributeValues: {
                ':cancelled': 'CANCELLED',
                ':source': source,
            },
        }),
    );
}

export async function markShowtimeClosing(showtimeId: string): Promise<void> {
    await docClient.send(
        new UpdateCommand({
            TableName: registryTableName(),
            Key: { registryKey: `SHOWTIME#${showtimeId}` },
            UpdateExpression: 'SET #status = :closing',
            ConditionExpression:
                'attribute_exists(registryKey) AND (attribute_not_exists(#status) OR #status = :active)',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
                ':closing': 'CLOSING',
                ':active': 'ACTIVE',
            },
        }),
    );
}

export async function reactivateShowtime(showtimeId: string): Promise<void> {
    await docClient.send(
        new UpdateCommand({
            TableName: registryTableName(),
            Key: { registryKey: `SHOWTIME#${showtimeId}` },
            UpdateExpression: 'SET #status = :active',
            ConditionExpression: 'attribute_exists(registryKey) AND #status = :closing',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: { ':active': 'ACTIVE', ':closing': 'CLOSING' },
        }),
    );
}

export async function reactivateManualShowtime(showtimeId: string): Promise<void> {
    await docClient.send(
        new UpdateCommand({
            TableName: registryTableName(),
            Key: { registryKey: `SHOWTIME#${showtimeId}` },
            UpdateExpression: 'SET #status = :active, #source = :manual',
            ConditionExpression: 'attribute_exists(registryKey) AND #status = :cancelled',
            ExpressionAttributeNames: {
                '#status': 'status',
                '#source': 'source',
            },
            ExpressionAttributeValues: {
                ':active': 'ACTIVE',
                ':manual': 'MANUAL',
                ':cancelled': 'CANCELLED',
            },
        }),
    );
}

export async function activateGeneratedShowtime(showtimeId: string): Promise<void> {
    await docClient.send(
        new UpdateCommand({
            TableName: registryTableName(),
            Key: { registryKey: `SHOWTIME#${showtimeId}` },
            UpdateExpression: 'SET #status = :active',
            ConditionExpression:
                '(attribute_not_exists(#source) OR #source = :generated) AND #status = :cancelled',
            ExpressionAttributeNames: {
                '#status': 'status',
                '#source': 'source',
            },
            ExpressionAttributeValues: {
                ':active': 'ACTIVE',
                ':generated': 'GENERATED',
                ':cancelled': 'CANCELLED',
            },
        }),
    );
}

export function parseShowtimeId(value: unknown):
    | {
          showtimeId: string;
          date: string;
          time: string;
      }
    | undefined {
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

    if (item.status === 'CANCELLED' || item.status === 'CLOSING') {
        throw new ShowtimeIdError(404, 'Showtime not found.');
    }

    if (item.status === undefined || item.GSI1PK === undefined || item.source === undefined) {
        await ensureShowtimeRecord(parsed.showtimeId, item, {
            source: item.source ?? 'GENERATED',
            runtime: item.runtime ?? 120,
        });
    }

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
    requestedDate?: string,
    source: 'GENERATED' | 'MANUAL' | 'OFFER' = 'GENERATED',
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
                showtimeId: await createShowtimeId(movieId, day, occurrenceDate, screening, {
                    source,
                }),
            })),
        );
    }

    return result;
}
