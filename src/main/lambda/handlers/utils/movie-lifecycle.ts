import type { MovieRecord } from '../../lib/interfaces';
import type { MovieLifecycleStatus } from '../../lib/interfaces/movie-summary';
import type { MovieShowtimes } from '../../lib/interfaces';

export function dateOnly(value: string): string {
    return value.slice(0, 10);
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function todayInTheatre(now = new Date()): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/London',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(now);
}

export function movieStartDate(movie: MovieRecord, today = todayInTheatre()): string {
    return movie.startDate ?? (dateOnly(movie.releaseDate) > today
        ? dateOnly(movie.releaseDate)
        : today);
}

export function isMovieScheduleDateAllowed(
    movie: MovieRecord,
    date: string,
    today = todayInTheatre()
): boolean {
    const releaseDate = dateOnly(movie.releaseDate);
    return date >= movieStartDate(movie, today)
        && (movie.runEndDate === undefined || date <= movie.runEndDate)
        && (date >= releaseDate || movie.preSalesEligible === true);
}

export function hasUpcomingTemplateScreenings(
    movie: MovieRecord,
    schedule: MovieShowtimes,
    today = todayInTheatre()
): boolean {
    const finalDate = new Date(`${today}T00:00:00.000Z`);
    const daysUntilSunday = (7 - finalDate.getUTCDay()) % 7;
    finalDate.setUTCDate(finalDate.getUTCDate() + daysUntilSunday + 5);
    const date = new Date(`${today}T00:00:00.000Z`);

    while (date <= finalDate) {
        const dateString = date.toISOString().slice(0, 10);
        const day = DAYS[date.getUTCDay()];
        if (
            isMovieScheduleDateAllowed(movie, dateString, today)
            && (schedule[day]?.length ?? 0) > 0
        ) {
            return true;
        }
        date.setUTCDate(date.getUTCDate() + 1);
    }
    return false;
}

export function movieLifecycleStatus(
    movie: MovieRecord,
    hasUpcomingScreenings: boolean,
    today = todayInTheatre()
): MovieLifecycleStatus {
    if (movie.runEndDate && today > movie.runEndDate) return 'Ended';
    if (dateOnly(movie.releaseDate) > today) {
        return movie.preSalesEligible && hasUpcomingScreenings
            ? 'Coming Soon (Pre-Sales Open)'
            : 'Coming Soon (No Showtimes Yet)';
    }
    return 'Now Showing';
}
