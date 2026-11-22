import {
    isMovieScheduleDateAllowed,
    movieLifecycleStatus,
} from '../../../main/lambda/handlers/utils/movie-lifecycle';
import type { MovieRecord } from '../../../main/lambda/lib/interfaces';

const movie: MovieRecord = {
    tmdbId: '123456',
    slug: 'example-movie',
    title: 'Example Movie',
    visible: true,
    genres: ['Drama'],
    mainGenre: 'Drama',
    rating: 'PG',
    score: 7,
    runtime: 100,
    releaseDate: '2026-12-20',
    startDate: '2026-12-10',
    preSalesEligible: true,
    poster: '',
    still: '',
    starring: [],
    director: '',
    synopsis: '',
    tagline: '',
    trailer: '',
};

describe('movie lifecycle scheduling', () => {
    it('opens pre-sales only for eligible upcoming movies with future screenings', () => {
        expect(movieLifecycleStatus(movie, true, '2026-11-01'))
            .toBe('Coming Soon (Pre-Sales Open)');
        expect(movieLifecycleStatus(movie, false, '2026-11-01'))
            .toBe('Coming Soon (No Showtimes Yet)');
        expect(movieLifecycleStatus(
            { ...movie, preSalesEligible: false },
            true,
            '2026-11-01'
        )).toBe('Coming Soon (No Showtimes Yet)');
    });

    it('allows explicit pre-release dates only within the configured start/end window', () => {
        expect(isMovieScheduleDateAllowed(movie, '2026-12-15', '2026-11-01')).toBe(true);
        expect(isMovieScheduleDateAllowed(
            { ...movie, runEndDate: '2026-12-14' },
            '2026-12-15',
            '2026-11-01'
        )).toBe(false);
        expect(isMovieScheduleDateAllowed(
            { ...movie, preSalesEligible: false },
            '2026-12-15',
            '2026-11-01'
        )).toBe(false);
    });

    it('reports an ended run after its configured end date', () => {
        expect(movieLifecycleStatus(
            { ...movie, runEndDate: '2026-10-31' },
            false,
            '2026-11-01'
        )).toBe('Ended');
    });
});
