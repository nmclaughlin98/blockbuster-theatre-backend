import type {
    MovieShowtimes,
    ScreenedShowtime,
} from '../interfaces';

const DAYS_OF_WEEK = [
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
    'Sunday',
] as const;

const POSSIBLE_TIMES = [
    '11:30',
    '12:15',
    '13:00',
    '14:20',
    '15:45',
    '16:30',
    '17:15',
    '18:00',
    '19:30',
    '20:15',
    '21:00',
    '21:45',
] as const;

const SCREENS = ['1', '2', '3', '4', '5'] as const;

function createRandom(seed: string): () => number {
    let state = 2166136261;
    for (const character of seed) {
        state = Math.imul(state ^ character.charCodeAt(0), 16777619);
    }

    return () => {
        state += 0x6d2b79f5;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

function isOlderThanOneYear(releaseDate: string, currentDate: Date): boolean {
    if (!releaseDate) return false;
    const parsedReleaseDate = new Date(releaseDate);
    if (Number.isNaN(parsedReleaseDate.getTime())) {
        throw new Error(`Invalid movie release date: ${releaseDate}`);
    }

    const releaseDay = Date.UTC(
        parsedReleaseDate.getUTCFullYear(),
        parsedReleaseDate.getUTCMonth(),
        parsedReleaseDate.getUTCDate()
    );
    const oneYearAgo = new Date(currentDate);
    oneYearAgo.setUTCHours(0, 0, 0, 0);
    oneYearAgo.setUTCFullYear(oneYearAgo.getUTCFullYear() - 1);
    return releaseDay < oneYearAgo.getTime();
}

export function generateShowtimes(
    movieId: string,
    releaseDate: string,
    score: number,
    currentDate: Date = new Date()
): MovieShowtimes {
    if (!Number.isFinite(score)) {
        throw new Error(`Movie ${movieId} has an invalid score.`);
    }

    const lowerPriority =
        isOlderThanOneYear(releaseDate, currentDate) || score < 5;
    const showDayChance = lowerPriority ? 0.6 : 0.85;
    const schedule: MovieShowtimes = {};

    for (const day of DAYS_OF_WEEK) {
        if (createRandom(`${movieId}:days:${day}`)() >= showDayChance) continue;

        const random = createRandom(`${movieId}:times:${day}`);
        const shuffledTimes = [...POSSIBLE_TIMES];
        for (let index = shuffledTimes.length - 1; index > 0; index--) {
            const swapIndex = Math.floor(random() * (index + 1));
            [shuffledTimes[index], shuffledTimes[swapIndex]] = [
                shuffledTimes[swapIndex],
                shuffledTimes[index],
            ];
        }

        const numberOfShowings = lowerPriority
            ? Math.floor(random() * 2) + 1
            : Math.floor(random() * 3) + 2;
        const screenRandom = createRandom(`${movieId}:screens:${day}`);
        schedule[day] = shuffledTimes
            .slice(0, numberOfShowings)
            .sort((first, second) => first.localeCompare(second))
            .map(
                (time): ScreenedShowtime => ({
                    screen: SCREENS[Math.floor(screenRandom() * SCREENS.length)],
                    time,
                })
            );
    }

    return schedule;
}
