import {
    DynamoDBDocumentClient,
    GetCommand,
    QueryCommand,
    ScanCommand,
    TransactWriteCommand,
    UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import {
    cancelManualShowtime,
    createManualShowtime,
    maintainRollingSchedule,
} from '../../../services/showtimes/movie-schedule-service';
import { todayInTheatre } from '../../../main/lambda/handlers/utils/movie-lifecycle';
import { generateShowtimes } from '../../../main/lambda/handlers/utils/showtime-schedule';
import type { MovieRecord } from '../../../main/lambda/lib/interfaces';

process.env.TABLE_NAME = 'test-movies';
process.env.SHOWTIME_REGISTRY_TABLE_NAME = 'test-showtime-registry';
process.env.BOOKINGS_TABLE_NAME = 'test-bookings';

const ddbMock = mockClient(DynamoDBDocumentClient);
const registry = new Map<string, Record<string, unknown>>();
let bookedShowtimeId: string | undefined;

const today = todayInTheatre();
const movie: MovieRecord = {
    tmdbId: '123456',
    slug: 'example-movie',
    title: 'Example Movie',
    visible: true,
    genres: ['Drama'],
    mainGenre: 'Drama',
    rating: 'PG',
    score: 7,
    runtime: 160,
    releaseDate: today,
    startDate: today,
    poster: '',
    still: '',
    starring: [],
    director: '',
    synopsis: '',
    tagline: '',
    trailer: '',
};

function nextScheduledDate(): string {
    const schedule = generateShowtimes(movie.tmdbId, movie.releaseDate, movie.score);
    const date = new Date(`${today}T00:00:00.000Z`);
    for (let offset = 1; offset <= 7; offset += 1) {
        date.setUTCDate(date.getUTCDate() + 1);
        const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
            date.getUTCDay()
        ];
        if (schedule[day]?.length) return date.toISOString().slice(0, 10);
    }
    throw new Error('The generated schedule should include at least one of the next seven days.');
}

describe('movie schedule service', () => {
    beforeEach(() => {
        ddbMock.reset();
        registry.clear();
        bookedShowtimeId = undefined;
        ddbMock.on(ScanCommand).resolves({ Items: [movie] });
        ddbMock.on(QueryCommand).callsFake((input) => {
            if (input.IndexName === 'ShowtimesByDate') {
                return {
                    Items: [...registry.values()].filter(
                        (record) =>
                            record.GSI1PK === input.ExpressionAttributeValues?.[':dateKey']
                    ),
                };
            }
            if (input.TableName === 'test-movies') return { Items: [movie] };
            if (
                input.TableName === 'test-bookings' &&
                input.ExpressionAttributeValues?.[':showtimeId'] === bookedShowtimeId
            ) {
                return { Items: [{ recordType: 'SEAT' }] };
            }
            return { Items: [] };
        });
        ddbMock.on(GetCommand).callsFake((input) => ({
            Item: registry.get(input.Key?.registryKey as string),
        }));
        ddbMock.on(TransactWriteCommand).callsFake((input) => {
            for (const action of input.TransactItems ?? []) {
                const item = action.Put?.Item;
                if (item && typeof item.registryKey === 'string') {
                    registry.set(item.registryKey, item);
                }
            }
            return {};
        });
        ddbMock.on(UpdateCommand).resolves({});
    });

    it('maintains at most four non-overlapping showings and keeps their IDs stable', async () => {
        const date = nextScheduledDate();
        const first = await maintainRollingSchedule({ dates: [date] });
        const firstDay = first.recordsByDate.get(date) ?? [];

        expect(firstDay.length).toBeLessThanOrEqual(4);
        expect(firstDay.every((record) =>
            record.source === 'GENERATED' && record.status === 'ACTIVE'
        )).toBe(true);

        for (const screen of new Set(firstDay.map((record) => record.screen))) {
            const screenings = firstDay
                .filter((record) => record.screen === screen)
                .sort((left, right) => String(left.time).localeCompare(String(right.time)));
            for (let index = 1; index < screenings.length; index += 1) {
                const previousEnd =
                    Number(String(screenings[index - 1].time).slice(0, 2)) * 60
                    + Number(String(screenings[index - 1].time).slice(3))
                    + movie.runtime
                    + 45;
                const nextStart =
                    Number(String(screenings[index].time).slice(0, 2)) * 60
                    + Number(String(screenings[index].time).slice(3));
                expect(nextStart).toBeGreaterThanOrEqual(previousEnd);
            }
        }

        const second = await maintainRollingSchedule({ dates: [date] });
        expect((second.recordsByDate.get(date) ?? []).map((record) => record.showtimeId))
            .toEqual(firstDay.map((record) => record.showtimeId));
    });

    it('does not generate screenings beyond the movie run end date', async () => {
        const date = nextScheduledDate();
        ddbMock.on(ScanCommand).resolves({
            Items: [{ ...movie, runEndDate: today }],
        });

        const result = await maintainRollingSchedule({ dates: [date] });

        expect(result.recordsByDate.get(date)).toEqual([]);
        expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
    });

    it('refuses to cancel a screening while seat locks are active', async () => {
        const date = new Date(`${today}T00:00:00.000Z`);
        date.setUTCDate(date.getUTCDate() + 10);
        const dateString = date.toISOString().slice(0, 10);
        const showtime = await createManualShowtime(movie.tmdbId, {
            date: dateString,
            screen: '5',
            time: '22:00',
        });
        bookedShowtimeId = showtime.showtimeId as string;

        await expect(cancelManualShowtime(movie.tmdbId, bookedShowtimeId))
            .rejects.toMatchObject({
                statusCode: 409,
                message: 'A screening with active bookings cannot be cancelled.',
            });
        expect(ddbMock.commandCalls(UpdateCommand).map((call) =>
            call.args[0].input.UpdateExpression
        )).toContain('SET #status = :closing');
    });
});
