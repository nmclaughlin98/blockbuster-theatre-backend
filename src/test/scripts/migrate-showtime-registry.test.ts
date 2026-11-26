import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { migrateShowtimeRegistry } from '../../../scripts/migrate-showtime-registry';

const dynamoMock = mockClient(DynamoDBDocumentClient);
const client = DynamoDBDocumentClient.from(
    new DynamoDBClient({
        region: 'eu-west-2',
        credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    }),
);

describe('showtime registry migration', () => {
    beforeEach(() => {
        dynamoMock.reset();
    });

    it('previews each scan page without writing', async () => {
        dynamoMock
            .on(ScanCommand)
            .resolvesOnce({
                Items: [{
                        registryKey: 'SHOWTIME#123456_2026-12-01_1900',
                        recordType: 'SHOWTIME',
                        showtimeId: '123456_2026-12-01_1900',
                        movieId: '123456',
                        date: '2026-12-01',
                        screen: '2',
                        time: '19:00',
                    },],
                LastEvaluatedKey: { registryKey: 'SHOWTIME#page-1' },
            })
            .resolves({ Items: [] });

        const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);

        const report = await migrateShowtimeRegistry(client, 'test-registry', false);

        expect(report).toEqual({ recordsScanned: 1, recordsUpdated: 1 });
        expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(2);
        expect(dynamoMock.commandCalls(UpdateCommand)).toHaveLength(0);
        expect(log).toHaveBeenCalledWith('Would update 123456_2026-12-01_1900 (2026-12-01 19:00)');
    });

    it('adds date-index fields and defaults without changing existing status metadata', async () => {
        dynamoMock.on(ScanCommand).resolves({
            Items: [{
                    registryKey: 'SHOWTIME#123456_2026-12-01_1900',
                    recordType: 'SHOWTIME',
                    showtimeId: '123456_2026-12-01_1900',
                    movieId: '123456',
                    date: '2026-12-01',
                    screen: '2',
                    time: '19:00',
                    source: 'MANUAL',
                    status: 'CANCELLED',
                },],
        });

        dynamoMock.on(UpdateCommand).resolves({});

        const report = await migrateShowtimeRegistry(client, 'test-registry', true);

        expect(report).toEqual({ recordsScanned: 1, recordsUpdated: 1 });
        expect(dynamoMock.commandCalls(UpdateCommand)[0].args[0].input).toMatchObject({
            Key: { registryKey: 'SHOWTIME#123456_2026-12-01_1900' },
            ExpressionAttributeValues: {
                ':gsi1pk': 'DATE#2026-12-01',
                ':gsi1sk': '2#19:00#123456#123456_2026-12-01_1900',
                ':active': 'ACTIVE',
                ':generated': 'GENERATED',
            },
        });
    });
});
