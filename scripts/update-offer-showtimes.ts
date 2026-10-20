import {
    DynamoDBDocumentClient,
    ScanCommand,
    UpdateCommand,
    type NativeAttributeValue,
} from '@aws-sdk/lib-dynamodb';
import type { MovieShowtimes } from '../src/main/lambda/handlers/interfaces';
import { createDynamoDBClient } from '../src/main/lambda/handlers/dynamodb-client';
import { isScreenedShowtime } from '../src/main/lambda/handlers/utils/movie-validation';
import { randomScreenForShowtime } from '../src/main/lambda/handlers/utils/showtime-schedule';

const DAYS_OF_WEEK = new Set([
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
    'Sunday',
]);
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

interface OfferUpdateReport {
    recordsScanned: number;
    offersWithOverrides: number;
    offersChanged: number;
}

interface PlannedOfferUpdate {
    offerId: string;
    showtimes: MovieShowtimes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function convertOfferShowtimes(
    offerId: string,
    value: unknown
): { showtimes: MovieShowtimes; changed: boolean } {
    if (!isRecord(value)) {
        throw new Error(`Offer ${offerId} has invalid overrideShowtimes.`);
    }

    const showtimes: MovieShowtimes = {};
    let changed = false;

    for (const [day, entries] of Object.entries(value)) {
        if (!DAYS_OF_WEEK.has(day) || !Array.isArray(entries)) {
            throw new Error(`Offer ${offerId} has invalid overrideShowtimes.`);
        }

        showtimes[day] = entries.map((entry, index) => {
            if (typeof entry === 'string' && TIME_PATTERN.test(entry)) {
                changed = true;
                return {
                    screen: randomScreenForShowtime(
                        `${offerId}:${day}:${index}:${entry}`
                    ),
                    time: entry,
                };
            }
            if (isScreenedShowtime(entry)) {
                return entry;
            }
            throw new Error(`Offer ${offerId} has an invalid showtime on ${day}.`);
        });
    }

    return { showtimes, changed };
}

export async function updateOfferShowtimes(
    client: DynamoDBDocumentClient,
    tableName: string,
    apply: boolean,
    reportUpdate: (offerId: string, showtimes: MovieShowtimes) => void = (
        offerId,
        showtimes
    ) => {
        console.log(
            `${apply ? 'Updating' : 'Would update'} offer ${offerId}:`,
            JSON.stringify(showtimes)
        );
    }
): Promise<OfferUpdateReport> {
    let exclusiveStartKey: Record<string, NativeAttributeValue> | undefined;
    const updates: PlannedOfferUpdate[] = [];
    let recordsScanned = 0;
    let offersWithOverrides = 0;

    do {
        const page = await client.send(
            new ScanCommand({
                TableName: tableName,
                ProjectionExpression: '#offerId, #overrideShowtimes',
                ExpressionAttributeNames: {
                    '#offerId': 'offerId',
                    '#overrideShowtimes': 'overrideShowtimes',
                },
                ExclusiveStartKey: exclusiveStartKey,
            })
        );

        for (const item of page.Items ?? []) {
            recordsScanned++;
            if (typeof item.offerId !== 'string' || !item.offerId) {
                throw new Error('The offers table contains a record without a valid offerId.');
            }
            if (item.overrideShowtimes === undefined) continue;

            offersWithOverrides++;
            const converted = convertOfferShowtimes(
                item.offerId,
                item.overrideShowtimes
            );
            if (!converted.changed) continue;
            updates.push({
                offerId: item.offerId,
                showtimes: converted.showtimes,
            });
            reportUpdate(item.offerId, converted.showtimes);
        }

        exclusiveStartKey = page.LastEvaluatedKey;
    } while (exclusiveStartKey);

    if (apply) {
        for (const update of updates) {
            await client.send(
                new UpdateCommand({
                    TableName: tableName,
                    Key: { offerId: update.offerId },
                    UpdateExpression: 'SET #overrideShowtimes = :overrideShowtimes',
                    ConditionExpression: 'attribute_exists(#offerId)',
                    ExpressionAttributeNames: {
                        '#offerId': 'offerId',
                        '#overrideShowtimes': 'overrideShowtimes',
                    },
                    ExpressionAttributeValues: {
                        ':overrideShowtimes': update.showtimes,
                    },
                })
            );
        }
    }

    return {
        recordsScanned,
        offersWithOverrides,
        offersChanged: updates.length,
    };
}

function requiredEnvironmentValue(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name} must be set.`);
    return value;
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    if (args.some((argument) => argument !== '--apply')) {
        throw new Error('The only supported argument is --apply.');
    }

    const tableName = requiredEnvironmentValue('OFFERS_TABLE_NAME');
    const apply = args.includes('--apply');
    const client = DynamoDBDocumentClient.from(createDynamoDBClient());
    const report = await updateOfferShowtimes(client, tableName, apply);

    console.log(
        `Scanned ${report.recordsScanned} offers; ${report.offersWithOverrides} have overrides; ${report.offersChanged} ${apply ? 'updated' : 'need screen assignments'}.`
    );
    console.log(
        apply
            ? 'Updates applied.'
            : 'Dry run only; rerun with --apply to write updates.'
    );
}

if (require.main === module) {
    main().catch((error: unknown) => {
        console.error('Failed to update offer showtimes:', error);
        process.exitCode = 1;
    });
}
