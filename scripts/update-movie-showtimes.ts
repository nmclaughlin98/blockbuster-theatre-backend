import {
    DynamoDBDocumentClient,
    ScanCommand,
    UpdateCommand,
    type NativeAttributeValue,
} from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from '../src/main/lambda/handlers/dynamodb-client';
import type { MovieShowtimes } from '../src/main/lambda/handlers/interfaces';
import { generateShowtimes } from '../src/main/lambda/handlers/utils/showtime-schedule';

export { generateShowtimes } from '../src/main/lambda/handlers/utils/showtime-schedule';

interface ShowtimeUpdateReport {
    recordsScanned: number;
    recordsUpdated: number;
}

export async function updateMovieShowtimes(
    client: DynamoDBDocumentClient,
    tableName: string,
    apply: boolean,
    reportUpdate: (
        tmdbId: string,
        title: string | undefined,
        showtimes: MovieShowtimes
    ) => void = (tmdbId, title, showtimes) => {
        console.log(
            `${apply ? 'Updating' : 'Would update'} ${title || tmdbId}:`,
            JSON.stringify(showtimes)
        );
    }
): Promise<ShowtimeUpdateReport> {
    let exclusiveStartKey: Record<string, NativeAttributeValue> | undefined;
    let recordsScanned = 0;
    let recordsUpdated = 0;
    const currentDate = new Date();

    do {
        const page = await client.send(
            new ScanCommand({
                TableName: tableName,
                ProjectionExpression: '#tmdbId, #slug, #title, #releaseDate, #score',
                ExpressionAttributeNames: {
                    '#tmdbId': 'tmdbId',
                    '#slug': 'slug',
                    '#title': 'title',
                    '#releaseDate': 'releaseDate',
                    '#score': 'score',
                },
                ExclusiveStartKey: exclusiveStartKey,
            })
        );

        for (const item of page.Items ?? []) {
            recordsScanned++;
            if (typeof item.tmdbId !== 'string' || typeof item.slug !== 'string') {
                throw new Error(
                    'The movie table contains a record without valid key attributes.'
                );
            }
            if (
                typeof item.releaseDate !== 'string' ||
                typeof item.score !== 'number' ||
                !Number.isFinite(item.score)
            ) {
                throw new Error(
                    `Movie ${item.tmdbId} must have a valid releaseDate and score.`
                );
            }

            const showtimes = generateShowtimes(
                item.tmdbId,
                item.releaseDate,
                item.score,
                currentDate
            );
            recordsUpdated++;
            reportUpdate(
                item.tmdbId,
                typeof item.title === 'string' ? item.title : undefined,
                showtimes
            );
            if (!apply) continue;

            await client.send(
                new UpdateCommand({
                    TableName: tableName,
                    Key: { tmdbId: item.tmdbId, slug: item.slug },
                    UpdateExpression: 'SET #showtimes = :showtimes',
                    ConditionExpression: 'attribute_exists(#tmdbId) AND attribute_exists(#slug)',
                    ExpressionAttributeNames: {
                        '#tmdbId': 'tmdbId',
                        '#slug': 'slug',
                        '#showtimes': 'showtimes',
                    },
                    ExpressionAttributeValues: {
                        ':showtimes': showtimes,
                    },
                })
            );
        }

        exclusiveStartKey = page.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return { recordsScanned, recordsUpdated };
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

    const tableName = requiredEnvironmentValue('MOVIE_TABLE_NAME');
    const apply = args.includes('--apply');
    const client = DynamoDBDocumentClient.from(createDynamoDBClient());
    const report = await updateMovieShowtimes(client, tableName, apply);

    console.log(
        `Scanned ${report.recordsScanned} movie records; ${report.recordsUpdated} showtime schedules ${apply ? 'updated' : 'previewed'}.`
    );
    console.log(
        apply
            ? 'Updates applied.'
            : 'Dry run only; rerun with --apply to write updates.'
    );
}

if (require.main === module) {
    main().catch((error: unknown) => {
        console.error('Failed to update movie showtimes:', error);
        process.exitCode = 1;
    });
}
