import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
    DynamoDBDocumentClient,
    ScanCommand,
    UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { migrateMovieImageUrls } from '../../../scripts/migrate-movie-image-urls';

const dynamoMock = mockClient(DynamoDBDocumentClient);
const client = DynamoDBDocumentClient.from(
    new DynamoDBClient({
        region: 'eu-west-2',
        credentials: {
            accessKeyId: 'test',
            secretAccessKey: 'test',
        },
    })
);

describe('movie image URL migration', () => {
    beforeEach(() => {
        dynamoMock.reset();
        dynamoMock.on(UpdateCommand).resolves({});
    });

    it('previews changes across all scan pages without writing records', async () => {
        dynamoMock.on(ScanCommand)
            .resolvesOnce({
                Items: [{
                    tmdbId: '1',
                    slug: 'first-movie',
                    poster: 'https://image.tmdb.org/t/p/w500/poster.jpg',
                    still: 'https://images.example.com/backdrop.jpg',
                }],
                LastEvaluatedKey: {
                    tmdbId: '1',
                    slug: 'first-movie',
                },
            })
            .resolves({
                Items: [{
                    tmdbId: '2',
                    slug: 'second-movie',
                    poster: 'https://image.tmdb.org/t/p/original/already-original.jpg',
                    still: 'https://image.tmdb.org/t/p/h632/backdrop.jpg',
                }],
            });
        const reportChange = jest.fn();

        const report = await migrateMovieImageUrls(
            client,
            'test-movies',
            false,
            reportChange
        );

        expect(report).toEqual({ recordsScanned: 2, recordsChanged: 2 });
        expect(reportChange).toHaveBeenNthCalledWith(1, '1', ['poster']);
        expect(reportChange).toHaveBeenNthCalledWith(2, '2', ['still']);
        expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(2);
        expect(dynamoMock.commandCalls(ScanCommand)[1].args[0].input.ExclusiveStartKey)
            .toEqual({ tmdbId: '1', slug: 'first-movie' });
        expect(dynamoMock.commandCalls(UpdateCommand)).toHaveLength(0);
    });

    it('updates only changed image attributes and preserves each filename', async () => {
        dynamoMock.on(ScanCommand).resolves({
            Items: [{
                tmdbId: '42',
                slug: 'a-movie',
                title: 'A Movie',
                poster: 'https://image.tmdb.org/t/p/w500/lHu1wtNaczFPGFDTrjCSzeLPTKN.jpg',
                still: 'https://image.tmdb.org/t/p/w1280/backdrop.jpg',
            }],
        });

        const report = await migrateMovieImageUrls(client, 'test-movies', true);

        expect(report).toEqual({ recordsScanned: 1, recordsChanged: 1 });
        expect(dynamoMock.commandCalls(UpdateCommand)[0].args[0].input).toMatchObject({
            TableName: 'test-movies',
            Key: { tmdbId: '42', slug: 'a-movie' },
            UpdateExpression: 'SET #field0 = :value0, #field1 = :value1',
            ExpressionAttributeNames: {
                '#field0': 'poster',
                '#field1': 'still',
            },
            ExpressionAttributeValues: {
                ':value0': 'https://image.tmdb.org/t/p/original/lHu1wtNaczFPGFDTrjCSzeLPTKN.jpg',
                ':value1': 'https://image.tmdb.org/t/p/original/backdrop.jpg',
            },
        });
        expect(dynamoMock.commandCalls(UpdateCommand)[0].args[0].input)
            .not.toHaveProperty('Item');
    });
});
