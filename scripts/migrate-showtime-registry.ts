import {
    DynamoDBDocumentClient,
    ScanCommand,
    UpdateCommand,
    type NativeAttributeValue,
} from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from '../src/main/lambda/handlers/Shared/dynamodb-client';

type RegistryRecord = Record<string, NativeAttributeValue>;

interface MigrationReport {
    recordsScanned: number;
    recordsUpdated: number;
}

function isShowtimeRecord(value: RegistryRecord): boolean {
    return (
        value.recordType === 'SHOWTIME' &&
        typeof value.registryKey === 'string' &&
        typeof value.showtimeId === 'string' &&
        typeof value.movieId === 'string' &&
        typeof value.date === 'string' &&
        typeof value.screen === 'string' &&
        typeof value.time === 'string'
    );
}

export async function migrateShowtimeRegistry(
    client: DynamoDBDocumentClient,
    tableName: string,
    apply: boolean,
): Promise<MigrationReport> {
    let exclusiveStartKey: RegistryRecord | undefined;
    let recordsScanned = 0;
    let recordsUpdated = 0;

    do {
        const page = await client.send(
            new ScanCommand({
                TableName: tableName,
                FilterExpression: '#recordType = :showtime',
                ExpressionAttributeNames: { '#recordType': 'recordType' },
                ExpressionAttributeValues: { ':showtime': 'SHOWTIME' },
                ExclusiveStartKey: exclusiveStartKey,
            }),
        );

        for (const rawRecord of page.Items ?? []) {
            const record = rawRecord as RegistryRecord;
            recordsScanned += 1;

            if (!isShowtimeRecord(record)) {
                throw new Error('The showtime registry contains an invalid SHOWTIME record.');
            }

            recordsUpdated += 1;
            console.log(
                `${apply ? 'Updating' : 'Would update'} ${record.showtimeId} (${record.date} ${record.time})`,
            );

            if (!apply) continue;

            await client.send(
                new UpdateCommand({
                    TableName: tableName,
                    Key: { registryKey: record.registryKey },
                    UpdateExpression: [
                        'SET #gsi1pk = :gsi1pk',
                        '#gsi1sk = :gsi1sk',
                        '#status = if_not_exists(#status, :active)',
                        '#source = if_not_exists(#source, :generated)',
                    ].join(', '),
                    ConditionExpression: '#recordType = :showtime',
                    ExpressionAttributeNames: {
                        '#gsi1pk': 'GSI1PK',
                        '#gsi1sk': 'GSI1SK',
                        '#status': 'status',
                        '#source': 'source',
                        '#recordType': 'recordType',
                    },
                    ExpressionAttributeValues: {
                        ':gsi1pk': `DATE#${record.date}`,
                        ':gsi1sk': `${record.screen}#${record.time}#${record.movieId}#${record.showtimeId}`,
                        ':active': 'ACTIVE',
                        ':generated': 'GENERATED',
                        ':showtime': 'SHOWTIME',
                    },
                }),
            );
        }

        exclusiveStartKey = page.LastEvaluatedKey as RegistryRecord | undefined;
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

    const tableName = requiredEnvironmentValue('SHOWTIME_REGISTRY_TABLE_NAME');
    const client = DynamoDBDocumentClient.from(createDynamoDBClient());
    const report = await migrateShowtimeRegistry(client, tableName, args.includes('--apply'));

    console.log(
        `Scanned ${report.recordsScanned} showtime records; ${report.recordsUpdated} registry records ${args.includes('--apply') ? 'updated' : 'previewed'}.`,
    );

    console.log(
        args.includes('--apply') ? 'Updates applied.' : 'Dry run only; rerun with --apply to write updates.',
    );
}

if (require.main === module) {
    main().catch((error: unknown) => {
        console.error('Failed to migrate showtime registry:', error);
        process.exitCode = 1;
    });
}
