import type { MovieShowtimes, ScreenedShowtime } from '../interfaces';

const DAYS = [
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
    'Sunday',
] as const;

export interface ParsedShowtimeId {
    movieId: string;
    day: (typeof DAYS)[number];
    screen: ScreenedShowtime['screen'];
    time: string;
}

export function createShowtimeId(
    movieId: string,
    day: string,
    showtime: Pick<ScreenedShowtime, 'screen' | 'time'>
): string {
    return `show_${movieId}_${day.toLowerCase()}_${showtime.screen}_${showtime.time.replace(':', '')}`;
}

export function parseShowtimeId(value: unknown): ParsedShowtimeId | undefined {
    if (typeof value !== 'string') return undefined;
    const match = /^show_(\d+)_(monday|tuesday|wednesday|thursday|friday|saturday|sunday)_([1-5])_([0-2]\d[0-5]\d)$/.exec(value);
    if (!match) return undefined;

    const day = DAYS.find((candidate) => candidate.toLowerCase() === match[2]);
    if (!day) return undefined;
    const time = `${match[4].slice(0, 2)}:${match[4].slice(2)}`;
    if (Number(time.slice(0, 2)) > 23) return undefined;

    return {
        movieId: match[1],
        day,
        screen: match[3] as ScreenedShowtime['screen'],
        time,
    };
}

export function addShowtimeIds(movieId: string, showtimes: MovieShowtimes): MovieShowtimes {
    return Object.fromEntries(
        Object.entries(showtimes).map(([day, screenings]) => [
            day,
            screenings.map((screening) => ({
                ...screening,
                showtimeId: createShowtimeId(movieId, day, screening),
            })),
        ])
    );
}
