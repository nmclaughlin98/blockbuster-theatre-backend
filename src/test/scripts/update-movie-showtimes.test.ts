import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
    DynamoDBDocumentClient,
    ScanCommand,
    UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import {
    generateShowtimes,
    updateMovieShowtimes,
} from '../../../scripts/update-movie-showtimes';

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

describe('movie showtime update', () => {
    const currentDate = new Date('2026-10-20T00:00:00.000Z');

    beforeEach(() => {
        dynamoMock.reset();
        dynamoMock.on(UpdateCommand).resolves({});
    });

    it('generates repeatable schedules with fewer showings for older or lower-scored movies', () => {
        const regularSchedule = generateShowtimes(
            '42',
            '2026-06-01',
            5,
            currentDate
        );
        const schedule = generateShowtimes(
            '42',
            '2026-06-01',
            5,
            currentDate
        );
        const oldSchedule = generateShowtimes(
            '42',
            '2025-10-19',
            8,
            currentDate
        );
        const lowScoreSchedule = generateShowtimes(
            '42',
            '2026-06-01',
            4.9,
            currentDate
        );

        expect(schedule).toEqual(regularSchedule);
        for (const times of Object.values(schedule)) {
            expect(times.length).toBeGreaterThanOrEqual(2);
            expect(times.length).toBeLessThanOrEqual(4);
            expect(times.map(({ time }) => time)).toEqual(
                [...times.map(({ time }) => time)].sort()
            );
            expect(
                times.every(
                    ({ screen, time }) =>
                        ['1', '2', '3', '4', '5'].includes(screen) &&
                        /^\d{2}:\d{2}$/.test(time)
                )
            ).toBe(true);
        }
        for (const reducedSchedule of [oldSchedule, lowScoreSchedule]) {
            expect(
                Object.keys(reducedSchedule).every((day) => day in regularSchedule)
            ).toBe(true);
            expect(
                Object.values(reducedSchedule).every(
                    (times) =>
                        times.length >= 1 &&
                        times.length <= 2 &&
                        times.every(({ screen }) =>
                            ['1', '2', '3', '4', '5'].includes(screen)
                        )
                )
            ).toBe(true);
        }
    });

    it('previews all scan pages without writing records', async () => {
        dynamoMock.on(ScanCommand)
            .resolvesOnce({
                Items: [{
                    tmdbId: '1',
                    slug: 'first-movie',
                    title: 'First Movie',
                    releaseDate: '2026-06-01',
                    score: 5,
                }],
                LastEvaluatedKey: { tmdbId: '1', slug: 'first-movie' },
            })
            .resolves({
                Items: [{
                    tmdbId: '2',
                    slug: 'second-movie',
                    title: 'Second Movie',
                    releaseDate: '2026-06-01',
                    score: 5,
                }],
            });
        const reportUpdate = jest.fn();

        const report = await updateMovieShowtimes(
            client,
            'test-movies',
            false,
            reportUpdate
        );

        expect(report).toEqual({ recordsScanned: 2, recordsUpdated: 2 });
        expect(reportUpdate).toHaveBeenNthCalledWith(
            1,
            '1',
            'First Movie',
            generateShowtimes('1', '2026-06-01', 5, currentDate)
        );
        expect(reportUpdate).toHaveBeenNthCalledWith(
            2,
            '2',
            'Second Movie',
            generateShowtimes('2', '2026-06-01', 5, currentDate)
        );
        expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(2);
        expect(dynamoMock.commandCalls(ScanCommand)[1].args[0].input.ExclusiveStartKey)
            .toEqual({ tmdbId: '1', slug: 'first-movie' });
        expect(dynamoMock.commandCalls(UpdateCommand)).toHaveLength(0);
    });

    it('updates only the showtimes field using the composite key', async () => {
        dynamoMock.on(ScanCommand).resolves({
            Items: [{
                tmdbId: '42',
                slug: 'a-movie',
                title: 'A Movie',
                releaseDate: '2026-06-01',
                score: 5,
            }],
        });

        const report = await updateMovieShowtimes(client, 'test-movies', true);

        expect(report).toEqual({ recordsScanned: 1, recordsUpdated: 1 });
        expect(dynamoMock.commandCalls(UpdateCommand)[0].args[0].input).toMatchObject({
            TableName: 'test-movies',
            Key: { tmdbId: '42', slug: 'a-movie' },
            UpdateExpression: 'SET #showtimes = :showtimes',
            ConditionExpression: 'attribute_exists(#tmdbId) AND attribute_exists(#slug)',
            ExpressionAttributeNames: {
                '#tmdbId': 'tmdbId',
                '#slug': 'slug',
                '#showtimes': 'showtimes',
            },
            ExpressionAttributeValues: {
                ':showtimes': generateShowtimes('42', '2026-06-01', 5),
            },
        });
    });

    it('fails when a scanned record does not have both key attributes', async () => {
        dynamoMock.on(ScanCommand).resolves({
            Items: [{ tmdbId: '42', releaseDate: '2026-06-01', score: 5 }],
        });

        await expect(updateMovieShowtimes(client, 'test-movies', true))
            .rejects.toThrow('The movie table contains a record without valid key attributes.');
        expect(dynamoMock.commandCalls(UpdateCommand)).toHaveLength(0);
    });

    it('fails when schedule classification data is missing', async () => {
        dynamoMock.on(ScanCommand).resolves({
            Items: [{ tmdbId: '42', slug: 'a-movie', releaseDate: '2026-06-01' }],
        });

        await expect(updateMovieShowtimes(client, 'test-movies', true))
            .rejects.toThrow('Movie 42 must have a valid releaseDate and score.');
        expect(dynamoMock.commandCalls(UpdateCommand)).toHaveLength(0);
    });
});
