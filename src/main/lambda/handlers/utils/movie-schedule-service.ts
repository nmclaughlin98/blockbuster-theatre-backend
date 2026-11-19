import {
    DynamoDBDocumentClient,
    DeleteCommand,
    QueryCommand,
    ScanCommand,
    type NativeAttributeValue,
} from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from '../Shared/dynamodb-client';
import type { MovieRecord, MovieShowtimes, ScreenedShowtime } from '../../lib/interfaces';
import {
    activateGeneratedShowtime,
    createShowtimeId,
    getShowtimeRecord,
    listShowtimesForDate,
    markShowtimeCancelled,
    markShowtimeClosing,
    reactivateManualShowtime,
    reactivateShowtime,
} from './showtime-ids';
import { isMovieRecord } from './movie-validation';
import { isMovieScheduleDateAllowed, movieStartDate, todayInTheatre } from './movie-lifecycle';
import {
    generateShowtimes,
    MAX_SCREENINGS_PER_MOVIE_PER_DAY,
    SCHEDULE_EXTENSION_DAYS,
    TURNAROUND_BUFFER_MINUTES,
} from './showtime-schedule';

const docClient = DynamoDBDocumentClient.from(createDynamoDBClient(), {
    marshallOptions: { removeUndefinedValues: true },
});
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const DEFAULT_RUNTIME_MINUTES = 120;

type DdbRecord = Record<string, NativeAttributeValue>;

export class MovieScheduleError extends Error {
    constructor(
        public readonly statusCode: number,
        message: string
    ) {
        super(message);
        this.name = 'MovieScheduleError';
    }
}

function requiredTableName(name: string): string {
    const tableName = process.env[name];
    if (!tableName) throw new Error(`${name} is not configured.`);
    return tableName;
}

function parseDate(value: unknown): string {
    if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
        throw new MovieScheduleError(400, 'date must use YYYY-MM-DD format.');
    }
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
        throw new MovieScheduleError(400, 'date must be a valid calendar date.');
    }
    return value;
}

function theatreTime(now = new Date()): string {
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).format(now);
}

function getWindowDates(today = todayInTheatre()): string[] {
    const start = new Date(`${today}T00:00:00.000Z`);
    const throughSunday = (7 - start.getUTCDay()) % 7;
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + throughSunday + SCHEDULE_EXTENSION_DAYS);

    const dates: string[] = [];
    for (const date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
        dates.push(date.toISOString().slice(0, 10));
    }
    return dates;
}

function runtimeOf(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? value
        : DEFAULT_RUNTIME_MINUTES;
}

function minuteOfDay(time: string): number {
    const [hour, minute] = time.split(':').map(Number);
    return hour * 60 + minute;
}

function hasConflict(
    candidate: { screen: string; time: string; runtime: number },
    scheduled: Array<Record<string, unknown>>
): boolean {
    const start = minuteOfDay(candidate.time);
    const end = start + candidate.runtime + TURNAROUND_BUFFER_MINUTES;
    return scheduled.some((other) => {
        if (other.screen !== candidate.screen || typeof other.time !== 'string') return false;
        const otherStart = minuteOfDay(other.time);
        const otherEnd = otherStart + runtimeOf(other.runtime) + TURNAROUND_BUFFER_MINUTES;
        return start < otherEnd && otherStart < end;
    });
}

function sameScreening(
    record: Record<string, unknown>,
    candidate: { movieId: string; screen: string; time: string }
): boolean {
    return record.movieId === candidate.movieId
        && record.screen === candidate.screen
        && record.time === candidate.time;
}

function dateDay(date: string): string {
    return DAYS[new Date(`${date}T00:00:00.000Z`).getUTCDay()];
}

async function getMovies(): Promise<MovieRecord[]> {
    const tableName = requiredTableName('TABLE_NAME');
    let exclusiveStartKey: DdbRecord | undefined;
    const movies: MovieRecord[] = [];
    do {
        const result = await docClient.send(new ScanCommand({
            TableName: tableName,
            ExclusiveStartKey: exclusiveStartKey,
        }));
        for (const item of result.Items ?? []) {
            const movie = item.visible === undefined ? { ...item, visible: true } : item;
            if (!isMovieRecord(movie)) {
                throw new Error('DynamoDB returned an invalid movie record.');
            }
            movies.push(movie);
        }
        exclusiveStartKey = result.LastEvaluatedKey as DdbRecord | undefined;
    } while (exclusiveStartKey);
    return movies;
}

async function getMovie(movieId: string): Promise<MovieRecord> {
    const result = await docClient.send(new QueryCommand({
        TableName: requiredTableName('TABLE_NAME'),
        KeyConditionExpression: 'tmdbId = :tmdbId',
        ExpressionAttributeValues: { ':tmdbId': movieId },
        Limit: 2,
        ConsistentRead: true,
    }));
    const items = result.Items ?? [];
    if (items.length === 0) throw new MovieScheduleError(404, 'Movie not found.');
    if (items.length !== 1 || !isMovieRecord(items[0])) {
        throw new Error('DynamoDB returned an invalid or ambiguous movie record.');
    }
    return items[0];
}

async function hasBookings(showtimeId: string): Promise<boolean> {
    let exclusiveStartKey: DdbRecord | undefined;
    do {
        const result = await docClient.send(new QueryCommand({
            TableName: requiredTableName('BOOKINGS_TABLE_NAME'),
            KeyConditionExpression: '#showtimeId = :showtimeId',
            FilterExpression: '#recordType = :seat',
            ExpressionAttributeNames: {
                '#showtimeId': 'showtimeId',
                '#recordType': 'recordType',
            },
            ExpressionAttributeValues: {
                ':showtimeId': showtimeId,
                ':seat': 'SEAT',
            },
            ProjectionExpression: '#recordType',
            ConsistentRead: true,
            Limit: 25,
            ExclusiveStartKey: exclusiveStartKey,
        }));
        if ((result.Items?.length ?? 0) > 0) return true;
        exclusiveStartKey = result.LastEvaluatedKey as DdbRecord | undefined;
    } while (exclusiveStartKey);
    return false;
}

async function closeIfUnbooked(
    showtimeId: string,
    source: 'GENERATED' | 'MANUAL' | 'OFFER'
): Promise<boolean> {
    await markShowtimeClosing(showtimeId);
    let booked: boolean;
    try {
        booked = await hasBookings(showtimeId);
    } catch (error: unknown) {
        await reactivateShowtime(showtimeId);
        throw error;
    }
    if (booked) {
        await reactivateShowtime(showtimeId);
        return false;
    }
    try {
        await markShowtimeCancelled(showtimeId, source);
        return true;
    } catch (error: unknown) {
        await reactivateShowtime(showtimeId);
        throw error;
    }
}

function isScheduleRecord(value: DdbRecord): value is DdbRecord & {
    showtimeId: string;
    movieId: string;
    date: string;
    screen: string;
    time: string;
} {
    return value.recordType === 'SHOWTIME'
        && typeof value.showtimeId === 'string'
        && typeof value.movieId === 'string'
        && typeof value.date === 'string'
        && typeof value.screen === 'string'
        && typeof value.time === 'string';
}

async function scheduleDate(
    date: string,
    movies: MovieRecord[]
): Promise<Array<Record<string, unknown>>> {
    const tableName = requiredTableName('SHOWTIME_REGISTRY_TABLE_NAME');
    const today = todayInTheatre();
    const nowTime = theatreTime();
    const movieById = new Map(movies.map((movie) => [movie.tmdbId, movie]));
    const candidates = new Map<string, {
        movie: MovieRecord;
        screen: ScreenedShowtime['screen'];
        time: string;
        runtime: number;
    }>();
    const day = dateDay(date);

    for (const movie of movies) {
        if (!movie.visible || !isMovieScheduleDateAllowed(movie, date, today)) continue;
        const template = generateShowtimes(movie.tmdbId, movie.releaseDate, movie.score);
        for (const screening of template[day] ?? []) {
            if (date === today && screening.time <= nowTime) continue;
            candidates.set(`${movie.tmdbId}|${screening.screen}|${screening.time}`, {
                movie,
                screen: screening.screen,
                time: screening.time,
                runtime: runtimeOf(movie.runtime),
            });
        }
    }

    const existing = (await listShowtimesForDate(date)).filter(isScheduleRecord);
    const active: Array<Record<string, unknown>> = [];
    const handledCandidates = new Set<string>();
    const scheduledKeys = new Set<string>();
    const sourceOf = (record: Record<string, unknown>) =>
        record.source === 'MANUAL' || record.source === 'OFFER' ? record.source : 'GENERATED';

    const cancelExisting = async (record: Record<string, unknown>) => {
        if (typeof record.showtimeId !== 'string') return;
        await closeIfUnbooked(record.showtimeId, sourceOf(record));
    };

    const manualRecords: DdbRecord[] = [];
    const bookedGenerated: DdbRecord[] = [];
    const candidateRecords: DdbRecord[] = [];

    for (const record of existing) {
        if (record.status === 'CANCELLED' || record.status === 'CLOSING') continue;
        const movie = movieById.get(record.movieId);
        const allowed = movie
            ? isMovieScheduleDateAllowed(movie, date, today)
            : false;
        const hasBooking = await hasBookings(record.showtimeId);
        const source = sourceOf(record);
        const candidateKey = `${record.movieId}|${record.screen}|${record.time}`;
        if (!allowed && !hasBooking) {
            await cancelExisting(record);
            continue;
        }
        if (source !== 'GENERATED') {
            manualRecords.push(record);
        } else if (hasBooking) {
            bookedGenerated.push(record);
        } else if (allowed && candidates.has(candidateKey)) {
            candidateRecords.push(record);
        } else {
            await cancelExisting(record);
        }
    }

    const reserve = (record: DdbRecord) => {
        const movie = movieById.get(record.movieId);
        active.push({
            ...record,
            runtime: runtimeOf(record.runtime ?? movie?.runtime),
        });
        scheduledKeys.add(`${record.movieId}|${record.screen}|${record.time}`);
    };
    for (const record of [...manualRecords, ...bookedGenerated]) reserve(record);

    for (const record of candidateRecords) {
        const key = `${record.movieId}|${record.screen}|${record.time}`;
        handledCandidates.add(key);
        const candidate = candidates.get(key)!;
        if (hasConflict({
            screen: record.screen,
            time: record.time,
            runtime: runtimeOf(record.runtime ?? candidate.runtime),
        }, active)) {
            await cancelExisting(record);
        } else {
            reserve(record);
        }
    }

    const orderedCandidates = [...candidates.entries()].sort((left, right) =>
        left[1].screen.localeCompare(right[1].screen)
        || left[1].time.localeCompare(right[1].time)
        || left[1].movie.tmdbId.localeCompare(right[1].movie.tmdbId)
    );
    for (const [key, candidate] of orderedCandidates) {
        if (handledCandidates.has(key) || scheduledKeys.has(key)) continue;
        const movieCount = active.filter((record) =>
            record.movieId === candidate.movie.tmdbId
        ).length;
        if (movieCount >= MAX_SCREENINGS_PER_MOVIE_PER_DAY) continue;
        if (hasConflict(candidate, active)) continue;

        const showtimeId = await createShowtimeId(
            candidate.movie.tmdbId,
            day,
            date,
            { screen: candidate.screen, time: candidate.time },
            { source: 'GENERATED', runtime: candidate.runtime }
        );
        let showtime = await getShowtimeRecord(showtimeId);
        if (!showtime) throw new Error(`Showtime ${showtimeId} was not persisted.`);
        if (showtime.status === 'CANCELLED' && showtime.source === 'MANUAL') continue;
        if (showtime.status === 'CANCELLED') {
            await activateGeneratedShowtime(showtimeId);
            showtime = await getShowtimeRecord(showtimeId);
            if (!showtime || showtime.status !== 'ACTIVE') continue;
        }
        if (hasConflict(candidate, active)) {
            await closeIfUnbooked(showtimeId, 'GENERATED');
            continue;
        }
        active.push(showtime);
        scheduledKeys.add(key);
    }

    return active;
}

async function cleanPastShowtimes(today: string): Promise<number> {
    let exclusiveStartKey: DdbRecord | undefined;
    let removed = 0;
    do {
        const page = await docClient.send(new ScanCommand({
            TableName: requiredTableName('SHOWTIME_REGISTRY_TABLE_NAME'),
            FilterExpression: '#recordType = :showtime AND #date < :today',
            ExpressionAttributeNames: {
                '#recordType': 'recordType',
                '#date': 'date',
                '#time': 'time',
            },
            ExpressionAttributeValues: {
                ':showtime': 'SHOWTIME',
                ':today': today,
            },
            ProjectionExpression: 'registryKey, showtimeId, movieId, #date, screen, #time',
            ExclusiveStartKey: exclusiveStartKey,
        }));
        for (const record of page.Items ?? []) {
            if (typeof record.showtimeId !== 'string') continue;
            if (await hasBookings(record.showtimeId)) continue;
            await docClient.send(new DeleteCommand({
                TableName: requiredTableName('SHOWTIME_REGISTRY_TABLE_NAME'),
                Key: { registryKey: record.registryKey },
            }));
            if (
                typeof record.movieId === 'string'
                && typeof record.date === 'string'
                && typeof record.screen === 'string'
                && typeof record.time === 'string'
            ) {
                await docClient.send(new DeleteCommand({
                    TableName: requiredTableName('SHOWTIME_REGISTRY_TABLE_NAME'),
                    Key: {
                        registryKey: `SCHEDULE#${record.movieId}#${record.date}#${record.screen}#${record.time}`,
                    },
                }));
            }
            removed++;
        }
        exclusiveStartKey = page.LastEvaluatedKey as DdbRecord | undefined;
    } while (exclusiveStartKey);
    return removed;
}

export async function maintainRollingSchedule(options: {
    dates?: string[];
    cleanPast?: boolean;
} = {}): Promise<{
    datesProcessed: number;
    screenings: number;
    staleScreeningsRemoved: number;
    recordsByDate: Map<string, Array<Record<string, unknown>>>;
}> {
    const movies = await getMovies();
    const today = todayInTheatre();
    const dates = options.dates ?? getWindowDates(today);
    let screenings = 0;
    const recordsByDate = new Map<string, Array<Record<string, unknown>>>();
    for (const date of dates) {
        const active = await scheduleDate(parseDate(date), movies);
        screenings += active.length;
        recordsByDate.set(date, active);
    }
    const staleScreeningsRemoved = options.cleanPast
        ? await cleanPastShowtimes(today)
        : 0;
    return {
        datesProcessed: dates.length,
        screenings,
        staleScreeningsRemoved,
        recordsByDate,
    };
}

export async function getMovieShowtimes(
    movie: MovieRecord,
    requestedDate?: string
): Promise<MovieShowtimes> {
    const today = todayInTheatre();
    const dates = requestedDate === undefined
        ? getWindowDates(today)
        : [parseDate(requestedDate)];
    if (dates.some((date) => date < today)) {
        throw new MovieScheduleError(400, 'date must not be in the past.');
    }
    const scheduledDates = dates.filter((date) => isMovieScheduleDateAllowed(movie, date, today));
    const recordsByDate = await Promise.all(scheduledDates.map(listShowtimesForDate));

    const result: MovieShowtimes = {};
    for (const [index, date] of scheduledDates.entries()) {
        const records = recordsByDate[index]
            .filter(isScheduleRecord)
            .filter((record) =>
                record.movieId === movie.tmdbId
                && record.status !== 'CANCELLED'
                && record.status !== 'CLOSING'
            );
        const day = dateDay(date);
        for (const record of records) {
            const screening: ScreenedShowtime = {
                showtimeId: record.showtimeId,
                date,
                screen: record.screen as ScreenedShowtime['screen'],
                time: record.time,
            };
            (result[day] ??= []).push(screening);
        }
    }
    for (const screenings of Object.values(result)) {
        screenings.sort((left, right) =>
            (left.date ?? '').localeCompare(right.date ?? '')
            || left.time.localeCompare(right.time)
        );
    }
    return result;
}

async function assertNoBookings(showtimeId: string): Promise<void> {
    if (await hasBookings(showtimeId)) {
        throw new MovieScheduleError(409, 'A screening with active bookings cannot be changed.');
    }
}

async function assertNoScreenConflict(
    movie: MovieRecord,
    date: string,
    screen: string,
    time: string,
    excludeShowtimeId?: string
): Promise<void> {
    const records = (await listShowtimesForDate(date))
        .filter(isScheduleRecord)
        .filter((record) =>
            record.status !== 'CANCELLED'
            && record.status !== 'CLOSING'
            && record.showtimeId !== excludeShowtimeId
        );
    const movieCount = records.filter((record) => record.movieId === movie.tmdbId).length;
    if (movieCount >= MAX_SCREENINGS_PER_MOVIE_PER_DAY) {
        throw new MovieScheduleError(409, 'A movie cannot have more than four screenings per day.');
    }
    if (hasConflict({ screen, time, runtime: runtimeOf(movie.runtime) }, records)) {
        throw new MovieScheduleError(409, 'The screen is already scheduled during this screening.');
    }
}

function validateScreeningDate(movie: MovieRecord, date: string): void {
    if (date < todayInTheatre()) {
        throw new MovieScheduleError(400, 'date must not be in the past.');
    }
    if (!isMovieScheduleDateAllowed(movie, date)) {
        throw new MovieScheduleError(
            400,
            'The screening date is outside the movie start/end dates or pre-sale eligibility.'
        );
    }
}

function parseScreening(value: unknown, partial = false): {
    date?: string;
    screen?: ScreenedShowtime['screen'];
    time?: string;
} {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new MovieScheduleError(400, 'A JSON screening object is required.');
    }
    const body = value as Record<string, unknown>;
    if (Object.keys(body).some((key) => !['date', 'screen', 'time'].includes(key))) {
        throw new MovieScheduleError(400, 'Only date, screen, and time are accepted.');
    }
    if (partial && Object.keys(body).length === 0) {
        throw new MovieScheduleError(400, 'At least one screening field must be provided.');
    }
    const { date, screen, time } = body;
    if (
        (!partial || date !== undefined) &&
        (typeof date !== 'string' || !DATE_PATTERN.test(date))
    ) {
        throw new MovieScheduleError(400, 'date must use YYYY-MM-DD format.');
    }
    if (
        (!partial || screen !== undefined) &&
        (typeof screen !== 'string' || !/^[1-5]$/.test(screen))
    ) {
        throw new MovieScheduleError(400, 'screen must be from 1 to 5.');
    }
    if ((!partial || time !== undefined) && (typeof time !== 'string' || !TIME_PATTERN.test(time))) {
        throw new MovieScheduleError(400, 'time must use HH:MM format.');
    }
    return {
        ...(typeof date === 'string' && { date: parseDate(date) }),
        ...(typeof screen === 'string' && { screen: screen as ScreenedShowtime['screen'] }),
        ...(typeof time === 'string' && { time }),
    };
}

export async function createManualShowtime(
    movieId: string,
    value: unknown
): Promise<Record<string, unknown>> {
    const movie = await getMovie(movieId);
    const screening = parseScreening(value);
    const date = screening.date!;
    const screen = screening.screen!;
    const time = screening.time!;
    validateScreeningDate(movie, date);
    await assertNoScreenConflict(movie, date, screen, time);

    const showtimeId = await createShowtimeId(
        movieId,
        dateDay(date),
        date,
        { screen, time },
        { source: 'MANUAL', runtime: runtimeOf(movie.runtime) }
    );
    const record = await getShowtimeRecord(showtimeId);
    if (record?.status === 'CANCELLED') {
        await reactivateManualShowtime(showtimeId);
    } else if (!record || record.status === 'CLOSING') {
        throw new MovieScheduleError(409, 'That screening has already been cancelled.');
    }
    return { showtimeId, movieId, date, day: dateDay(date), screen, time, source: 'MANUAL' };
}

export async function updateManualShowtime(
    movieId: string,
    showtimeId: string,
    value: unknown
): Promise<Record<string, unknown>> {
    const movie = await getMovie(movieId);
    const current = await getShowtimeRecord(showtimeId);
    if (
        !current
        || current.movieId !== movieId
        || current.status === 'CANCELLED'
        || current.status === 'CLOSING'
    ) {
        throw new MovieScheduleError(404, 'Showtime not found.');
    }
    const updates = parseScreening(value, true);
    const date = updates.date ?? String(current.date);
    const screen = updates.screen ?? String(current.screen) as ScreenedShowtime['screen'];
    const time = updates.time ?? String(current.time);
    parseDate(date);
    validateScreeningDate(movie, date);

    const sameIdentity = date === current.date && screen === current.screen && time === current.time;
    if (sameIdentity) {
        await assertNoBookings(showtimeId);
        await createShowtimeId(
            movieId,
            dateDay(date),
            date,
            { screen, time },
            { source: 'MANUAL', runtime: runtimeOf(movie.runtime) }
        );
        return { showtimeId, movieId, date, day: dateDay(date), screen, time, source: 'MANUAL' };
    }

    await markShowtimeClosing(showtimeId);
    let booked: boolean;
    try {
        booked = await hasBookings(showtimeId);
    } catch (error: unknown) {
        await reactivateShowtime(showtimeId);
        throw error;
    }
    if (booked) {
        await reactivateShowtime(showtimeId);
        throw new MovieScheduleError(409, 'A screening with active bookings cannot be changed.');
    }
    try {
        await assertNoScreenConflict(movie, date, screen, time, showtimeId);
        const newShowtimeId = await createShowtimeId(
            movieId,
            dateDay(date),
            date,
            { screen, time },
            { source: 'MANUAL', runtime: runtimeOf(movie.runtime) }
        );
        const target = await getShowtimeRecord(newShowtimeId);
        if (target?.status === 'CANCELLED') {
            await reactivateManualShowtime(newShowtimeId);
        } else if (!target || target.status === 'CLOSING') {
            throw new MovieScheduleError(409, 'That screening has already been cancelled.');
        }
        await markShowtimeCancelled(showtimeId);
        return {
            showtimeId: newShowtimeId,
            previousShowtimeId: showtimeId,
            movieId,
            date,
            day: dateDay(date),
            screen,
            time,
            source: 'MANUAL',
        };
    } catch (error: unknown) {
        await reactivateShowtime(showtimeId);
        throw error;
    }
}

export async function cancelManualShowtime(
    movieId: string,
    showtimeId: string
): Promise<void> {
    const current = await getShowtimeRecord(showtimeId);
    if (!current || current.movieId !== movieId || current.status === 'CANCELLED') {
        throw new MovieScheduleError(404, 'Showtime not found.');
    }
    const claimed = await closeIfUnbooked(showtimeId, 'MANUAL');
    if (!claimed) {
        throw new MovieScheduleError(409, 'A screening with active bookings cannot be cancelled.');
    }
}

export function defaultMovieStartDate(movie: MovieRecord): string {
    return movieStartDate(movie);
}
