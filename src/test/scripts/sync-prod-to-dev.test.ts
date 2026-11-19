import {
    DescribeTableCommand,
    DynamoDBClient,
    ListTablesCommand,
} from '@aws-sdk/client-dynamodb';
import {
    BatchWriteCommand,
    DynamoDBDocumentClient,
    ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import {
    PROD_TABLE_NAMES,
    PROD_TO_DEV_TABLES,
    syncProdToDev,
} from '../../../scripts/sync-prod-to-dev';

const dynamoMock = mockClient(DynamoDBClient);
const documentMock = mockClient(DynamoDBDocumentClient);

describe('sync production data to dev', () => {
    beforeEach(() => {
        dynamoMock.reset();
        documentMock.reset();
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('defines a -DEV counterpart for every production table', () => {
        expect(PROD_TO_DEV_TABLES).toHaveLength(PROD_TABLE_NAMES.length);
        for (const mapping of PROD_TO_DEV_TABLES) {
            expect(mapping.targetTable).toBe(`${mapping.sourceTable}-DEV`);
        }
    });

    it.each(['production', 'lowercase'])('rejects %s targets before any DynamoDB operation', async (kind) => {
        const sourceTable = PROD_TABLE_NAMES[0];
        await expect(syncProdToDev(
            {} as DynamoDBClient,
            {} as DynamoDBDocumentClient,
            {
                mappings: [{
                    sourceTable,
                    targetTable: kind === 'production' ? sourceTable : `${sourceTable}-dev`,
                }],
                clear: true,
            }
        )).rejects.toThrow('Unsafe sync target');

        expect(dynamoMock.commandCalls(ListTablesCommand)).toHaveLength(0);
        expect(documentMock.commandCalls(BatchWriteCommand)).toHaveLength(0);
    });

    it('paginates production scans, batches at 25 items, and retries unprocessed writes', async () => {
        const { sourceTable, targetTable } = PROD_TO_DEV_TABLES[0];
        dynamoMock.on(ListTablesCommand).resolves({
            TableNames: [sourceTable, targetTable],
        });
        dynamoMock.on(DescribeTableCommand).resolves({
            Table: { KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }] },
        });
        documentMock.on(ScanCommand, { TableName: sourceTable })
            .resolvesOnce({
                Items: Array.from({ length: 26 }, (_, id) => ({ id })),
                LastEvaluatedKey: { id: 25 },
            })
            .resolvesOnce({ Items: [{ id: 26 }] });
        documentMock.on(BatchWriteCommand)
            .resolvesOnce({
                UnprocessedItems: {
                    [targetTable]: [{ PutRequest: { Item: { id: 0 } } }],
                },
            })
            .resolves({});
        const sleep = jest.fn().mockResolvedValue(undefined);

        const result = await syncProdToDev(
            dynamoMock as unknown as DynamoDBClient,
            documentMock as unknown as DynamoDBDocumentClient,
            {
                mappings: [{ sourceTable, targetTable }],
                sleep,
            }
        );

        const batches = documentMock.commandCalls(BatchWriteCommand);
        expect(batches).toHaveLength(4);
        expect(batches[0].args[0].input.RequestItems?.[targetTable]).toHaveLength(25);
        expect(batches[1].args[0].input.RequestItems?.[targetTable]).toHaveLength(1);
        expect(sleep).toHaveBeenCalledWith(100);
        expect(result.copiedItems).toBe(27);
    });

    it('clears only the dev target using its discovered key before copying', async () => {
        const { sourceTable, targetTable } = PROD_TO_DEV_TABLES[0];
        dynamoMock.on(ListTablesCommand).resolves({
            TableNames: [sourceTable, targetTable],
        });
        dynamoMock.on(DescribeTableCommand).resolves({
            Table: { KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }] },
        });
        documentMock.on(ScanCommand, { TableName: targetTable }).resolves({
            Items: [{ id: 'existing-dev' }],
        });
        documentMock.on(ScanCommand, { TableName: sourceTable }).resolves({
            Items: [{ id: 'source' }],
        });
        documentMock.on(BatchWriteCommand).resolves({});

        await syncProdToDev(
            dynamoMock as unknown as DynamoDBClient,
            documentMock as unknown as DynamoDBDocumentClient,
            {
                mappings: [{ sourceTable, targetTable }],
                clear: true,
                sleep: jest.fn().mockResolvedValue(undefined),
            }
        );

        const writes = documentMock.commandCalls(BatchWriteCommand);
        expect(writes).toHaveLength(2);
        expect(writes[0].args[0].input.RequestItems?.[targetTable]).toEqual([
            { DeleteRequest: { Key: { id: 'existing-dev' } } },
        ]);
        expect(writes[1].args[0].input.RequestItems?.[targetTable]).toEqual([
            { PutRequest: { Item: { id: 'source' } } },
        ]);
    });
});
