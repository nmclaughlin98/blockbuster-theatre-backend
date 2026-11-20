import {
    DynamoDBDocumentClient,
    ScanCommand,
    UpdateCommand,
    type NativeAttributeValue,
} from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from '../src/main/lambda/handlers/Shared/dynamodb-client';

type MovieRecord = Record<string, NativeAttributeValue>;

interface MigrationReport {
    recordsScanned: number;
    legacySchedulesFound: number;
    recordsUpdated: number;
}

export async function removeLegacyMovieShowtimes(
    client: DynamoDBDocumentClient,
    tableName: string,
    apply: boolean,
    reportSchedule: (record: MovieRecord, apply: boolean) => void = (record, willApply) => {
        console.log(
            `${willApply ? 'Removing' : 'Would remove'} legacy schedule from ${record.title ?? record.movieId}:`,
            JSON.stringify(record.showtimes)
        );
    }
): Promise<MigrationReport> {
    let exclusiveStartKey: MovieRecord | undefined;
    let recordsScanned = 0;
    let legacySchedulesFound = 0;
    let recordsUpdated = 0;

    do {
        const page = await client.send(new ScanCommand({
            TableName: tableName,
            ProjectionExpression: '#movieId, #title, #showtimes',
            ExpressionAttributeNames: {
                '#movieId': 'movieId',
                '#title': 'title',
                '#showtimes': 'showtimes',
            },
            ExclusiveStartKey: exclusiveStartKey,
        }));

        for (const rawRecord of page.Items ?? []) {
            const record = rawRecord as MovieRecord;
            recordsScanned += 1;
            if (
                typeof record.movieId !== 'string'
            ) {
                throw new Error('The movie table contains a record without valid key attributes.');
            }
            if (record.showtimes === undefined) continue;

            legacySchedulesFound += 1;
            reportSchedule(record, apply);
            if (!apply) continue;

            await client.send(new UpdateCommand({
                TableName: tableName,
                Key: { movieId: record.movieId },
                UpdateExpression: 'REMOVE #showtimes',
                ConditionExpression:
                    'attribute_exists(#movieId) AND attribute_exists(#showtimes)',
                ExpressionAttributeNames: {
                    '#movieId': 'movieId',
                    '#showtimes': 'showtimes',
                },
            }));
            recordsUpdated += 1;
        }

        exclusiveStartKey = page.LastEvaluatedKey as MovieRecord | undefined;
    } while (exclusiveStartKey);

    return { recordsScanned, legacySchedulesFound, recordsUpdated };
}

function requiredEnvironmentValue(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name} must be set.`);
    return value;
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    if (args.some(
        (argument) => argument !== '--apply' && argument !== '--confirm-overrides-reviewed'
    )) {
        throw new Error('Supported arguments are --apply and --confirm-overrides-reviewed.');
    }
    if (
        args.includes('--apply') &&
        !args.includes('--confirm-overrides-reviewed')
    ) {
        throw new Error(
            'Review and recreate any customized screenings first, then include --confirm-overrides-reviewed with --apply.'
        );
    }

    const tableName = requiredEnvironmentValue('MOVIE_TABLE_NAME');
    const client = DynamoDBDocumentClient.from(createDynamoDBClient());
    const apply = args.includes('--apply');
    if (apply) {
        console.warn(
            'Removing legacy movie schedules permanently. Customized schedules must already be represented by explicit screenings in the registry.'
        );
    }
    const report = await removeLegacyMovieShowtimes(client, tableName, apply);

    console.log(
        `Scanned ${report.recordsScanned} movie records; found ${report.legacySchedulesFound} legacy schedules; removed ${report.recordsUpdated}.`
    );
    console.log(
        apply
            ? 'Updates applied.'
            : 'Dry run only; recreate any customized screenings through the manual API, then rerun with --apply to remove legacy attributes.'
    );
}

if (require.main === module) {
    main().catch((error: unknown) => {
        console.error('Failed to migrate legacy movie showtimes:', error);
        process.exitCode = 1;
    });
}
