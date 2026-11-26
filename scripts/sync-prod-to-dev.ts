import { DescribeTableCommand, type DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
    BatchWriteCommand,
    DynamoDBDocumentClient,
    ScanCommand,
    type BatchWriteCommandInput,
    type NativeAttributeValue,
} from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from '../src/main/lambda/handlers/Shared/dynamodb-client';
import { resourceName } from '../lib/shared';

const TABLE_BASE_NAMES = [
    'blockbuster-theatre-movie-catalogue',
    'blockbuster-theatre-ticket-pricing',
    'blockbuster-theatre-booking-offers',
    'blockbuster-theatre-movie-collections',
    'blockbuster-theatre-bookings',
    'blockbuster-theatre-bookings-by-showtime',
    'blockbuster-theatre-showtime-registry',
    'blockbuster-theatre-booking-references',
    'blockbuster-theatre-guest-conversion-tokens',
] as const;

export const PROD_TABLE_NAMES = TABLE_BASE_NAMES.map((name) => resourceName(name, 'prod'));

export interface TableMapping {
    sourceTable: string;
    targetTable: string;
}

type DocumentItem = Record<string, NativeAttributeValue>;
type WriteRequest = NonNullable<BatchWriteCommandInput['RequestItems']>[string][number];
type KeySchema = Array<{ AttributeName?: string; KeyType?: string }>;

const MAX_BATCH_SIZE = 25;
const MAX_UNPROCESSED_RETRIES = 8;
const INITIAL_RETRY_DELAY_MS = 100;
const MAX_RETRY_DELAY_MS = 5000;

export const PROD_TO_DEV_TABLES: TableMapping[] = TABLE_BASE_NAMES.map((name) => ({
    sourceTable: resourceName(name, 'prod'),
    targetTable: resourceName(name, 'dev'),
}));

export function assertSafeTargetTables(
    mappings: readonly TableMapping[],
    productionTableNames: ReadonlySet<string>,
): void {
    if (mappings.length === 0) {
        throw new Error('No DynamoDB tables were configured for synchronization.');
    }

    const seenTargets = new Set<string>();

    for (const { sourceTable, targetTable } of mappings) {
        const expectedTarget = PROD_TO_DEV_TABLES.find(
            (mapping) => mapping.sourceTable === sourceTable,
        )?.targetTable;

        if (
            !expectedTarget ||
            targetTable !== expectedTarget ||
            !targetTable.startsWith('blockbuster-theatre-dev-') ||
            productionTableNames.has(targetTable) ||
            targetTable === sourceTable ||
            seenTargets.has(targetTable)
        ) {
            throw new Error(
                `Unsafe sync target "${targetTable}". Every target must be a unique blockbuster-theatre-dev- table and must not match a production table.`,
            );
        }

        seenTargets.add(targetTable);
    }
}

function getKeySchema(keySchema: KeySchema | undefined, tableName: string): string[] {
    if (!keySchema) throw new Error(`Table "${tableName}" has no key schema.`);

    const orderedKeys = keySchema
        .slice()
        .sort((left, right) => (left.KeyType === 'HASH' ? -1 : right.KeyType === 'HASH' ? 1 : 0));

    if (
        orderedKeys.length < 1 ||
        orderedKeys.length > 2 ||
        orderedKeys.some((key) => !key.AttributeName || !['HASH', 'RANGE'].includes(key.KeyType ?? '')) ||
        orderedKeys[0].KeyType !== 'HASH' ||
        (orderedKeys.length === 2 && orderedKeys[1].KeyType !== 'RANGE')
    ) {
        throw new Error(`Table "${tableName}" has an unsupported DynamoDB key schema.`);
    }

    return orderedKeys.map((key) => key.AttributeName!);
}

async function getTableKeySchema(client: DynamoDBClient, tableName: string): Promise<KeySchema> {
    const response = await client.send(new DescribeTableCommand({ TableName: tableName }));

    if (!response.Table?.KeySchema) {
        throw new Error(`Unable to describe DynamoDB table "${tableName}".`);
    }

    return response.Table.KeySchema;
}

function assertMatchingKeySchemas(
    source: KeySchema,
    target: KeySchema,
    sourceName: string,
    targetName: string,
): string[] {
    const targetKeys = getKeySchema(target, targetName);
    const sourceKeyTypes = source.map((key) => `${key.KeyType}:${key.AttributeName}`).sort();
    const targetKeyTypes = target.map((key) => `${key.KeyType}:${key.AttributeName}`).sort();

    if (sourceKeyTypes.join('|') !== targetKeyTypes.join('|')) {
        throw new Error(
            `Source table "${sourceName}" and target table "${targetName}" have different key schemas.`,
        );
    }

    return targetKeys;
}

function chunks<T>(values: readonly T[], size: number): T[][] {
    const result: T[][] = [];

    for (let index = 0; index < values.length; index += size) {
        result.push(values.slice(index, index + size));
    }

    return result;
}

async function writeBatchWithRetry(
    documentClient: DynamoDBDocumentClient,
    tableName: string,
    requests: WriteRequest[],
    sleep: (milliseconds: number) => Promise<void>,
): Promise<void> {
    let pending = requests;

    for (let attempt = 0; pending.length > 0; attempt += 1) {
        const response = await documentClient.send(
            new BatchWriteCommand({
                RequestItems: { [tableName]: pending },
            }),
        );

        pending = response.UnprocessedItems?.[tableName] ?? [];

        if (pending.length === 0) return;

        if (attempt >= MAX_UNPROCESSED_RETRIES) {
            throw new Error(
                `DynamoDB left ${pending.length} write(s) unprocessed for "${tableName}" after ${MAX_UNPROCESSED_RETRIES} retries.`,
            );
        }

        const delay = Math.min(INITIAL_RETRY_DELAY_MS * 2 ** attempt, MAX_RETRY_DELAY_MS);
        await sleep(delay);
    }
}

async function forEachScanPage(
    documentClient: DynamoDBDocumentClient,
    tableName: string,
    processItems: (items: DocumentItem[]) => Promise<void>,
    consistentRead = false,
): Promise<void> {
    let exclusiveStartKey: DocumentItem | undefined;
    do {
        const page = await documentClient.send(
            new ScanCommand({
                TableName: tableName,
                ExclusiveStartKey: exclusiveStartKey,
                ConsistentRead: consistentRead,
            }),
        );

        await processItems((page.Items ?? []) as DocumentItem[]);
        exclusiveStartKey = page.LastEvaluatedKey as DocumentItem | undefined;
    } while (exclusiveStartKey);
}

async function clearTable(
    documentClient: DynamoDBDocumentClient,
    tableName: string,
    keyNames: string[],
    sleep: (milliseconds: number) => Promise<void>,
): Promise<number> {
    let deletedItems = 0;
    await forEachScanPage(
        documentClient,
        tableName,
        async (items) => {
            const requests: WriteRequest[] = items.map((item) => {
                const key: DocumentItem = {};

                for (const keyName of keyNames) {
                    if (!(keyName in item)) {
                        throw new Error(`Item in "${tableName}" is missing key "${keyName}".`);
                    }

                    key[keyName] = item[keyName];
                }

                return { DeleteRequest: { Key: key } };
            });

            for (const batch of chunks(requests, MAX_BATCH_SIZE)) {
                await writeBatchWithRetry(documentClient, tableName, batch, sleep);
                deletedItems += batch.length;
            }
        },
        true,
    );

    return deletedItems;
}

async function copyTable(
    documentClient: DynamoDBDocumentClient,
    sourceTable: string,
    targetTable: string,
    sleep: (milliseconds: number) => Promise<void>,
): Promise<number> {
    let copiedItems = 0;
    await forEachScanPage(documentClient, sourceTable, async (items) => {
        const requests: WriteRequest[] = items.map((item) => ({
            PutRequest: { Item: item },
        }));

        for (const batch of chunks(requests, MAX_BATCH_SIZE)) {
            await writeBatchWithRetry(documentClient, targetTable, batch, sleep);
            copiedItems += batch.length;
        }
    });

    return copiedItems;
}

export async function syncProdToDev(
    dynamoClient: DynamoDBClient,
    documentClient: DynamoDBDocumentClient,
    options: {
        clear?: boolean;
        mappings?: readonly TableMapping[];
        sleep?: (milliseconds: number) => Promise<void>;
    } = {},
): Promise<{ copiedItems: number; elapsedMilliseconds: number }> {
    const mappings = options.mappings ?? PROD_TO_DEV_TABLES;
    const startedAt = Date.now();
    const sleep =
        options.sleep ??
        ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

    assertSafeTargetTables(mappings, new Set(PROD_TABLE_NAMES));
    const keyNamesByTarget = new Map<string, string[]>();

    for (const { sourceTable, targetTable } of mappings) {
        const [sourceSchema, targetSchema] = await Promise.all([
            getTableKeySchema(dynamoClient, sourceTable),
            getTableKeySchema(dynamoClient, targetTable),
        ]);

        keyNamesByTarget.set(
            targetTable,
            assertMatchingKeySchemas(sourceSchema, targetSchema, sourceTable, targetTable),
        );
    }

    if (options.clear) {
        for (const { targetTable } of mappings) {
            const deletedItems = await clearTable(
                documentClient,
                targetTable,
                keyNamesByTarget.get(targetTable)!,
                sleep,
            );

            console.log(`Cleared ${deletedItems} item(s) from ${targetTable}.`);
        }
    }

    let copiedItems = 0;

    for (const { sourceTable, targetTable } of mappings) {
        const copiedFromTable = await copyTable(documentClient, sourceTable, targetTable, sleep);
        copiedItems += copiedFromTable;
        console.log(`Copied ${copiedFromTable} item(s): ${sourceTable} -> ${targetTable}.`);
    }

    const elapsedMilliseconds = Date.now() - startedAt;
    console.log(
        `Copied ${copiedItems} item(s) across ${mappings.length} table(s) in ${(elapsedMilliseconds / 1000).toFixed(2)} seconds.`,
    );

    return { copiedItems, elapsedMilliseconds };
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);

    if (args.some((argument) => argument !== '--clear')) {
        throw new Error('The only supported option is --clear.');
    }

    const dynamoClient = createDynamoDBClient();
    const documentClient = DynamoDBDocumentClient.from(dynamoClient);
    await syncProdToDev(dynamoClient, documentClient, { clear: args.includes('--clear') });
}

if (require.main === module) {
    main().catch((error: unknown) => {
        console.error('Failed to sync production data to development:', error);
        process.exitCode = 1;
    });
}
