import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { removeLegacyMovieShowtimes } from '../../../scripts/migrate-movie-showtimes';

const dynamoMock = mockClient(DynamoDBDocumentClient);
const client = DynamoDBDocumentClient.from(
    new DynamoDBClient({
        region: 'eu-west-2',
        credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    }),
);

describe('legacy movie showtime migration', () => {
    beforeEach(() => {
        dynamoMock.reset();
    });

    it('previews legacy schedules without changing movie records', async () => {
        dynamoMock.on(ScanCommand).resolves({
            Items: [{
                    tmdbId: '123456',
                    slug: 'example-movie',
                    title: 'Example Movie',
                    showtimes: { Monday: [{ screen: '2', time: '19:00' }] },
                },],
        });

        const reportSchedule = jest.fn();

        const report = await removeLegacyMovieShowtimes(client, 'test-movies', false, reportSchedule);

        expect(report).toEqual({
            recordsScanned: 1,
            legacySchedulesFound: 1,
            recordsUpdated: 0,
        });

        expect(reportSchedule).toHaveBeenCalledWith(expect.objectContaining({ tmdbId: '123456' }), false);
        expect(dynamoMock.commandCalls(UpdateCommand)).toHaveLength(0);
    });

    it('removes only the legacy showtimes attribute using the composite key', async () => {
        dynamoMock.on(ScanCommand).resolves({
            Items: [{
                    tmdbId: '123456',
                    slug: 'example-movie',
                    title: 'Example Movie',
                    showtimes: { Monday: [{ screen: '2', time: '19:00' }] },
                },],
        });

        const report = await removeLegacyMovieShowtimes(client, 'test-movies', true);

        expect(report).toEqual({
            recordsScanned: 1,
            legacySchedulesFound: 1,
            recordsUpdated: 1,
        });

        expect(dynamoMock.commandCalls(UpdateCommand)[0].args[0].input).toMatchObject({
            Key: { tmdbId: '123456', slug: 'example-movie' },
            UpdateExpression: 'REMOVE #showtimes',
            ExpressionAttributeNames: { '#showtimes': 'showtimes' },
        });
    });
});
