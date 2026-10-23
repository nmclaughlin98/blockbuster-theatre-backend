import {
    isMovieRecord,
    isMovieShowtimes,
    isScreenedShowtime,
    isTmdbMovieResponse,
} from '../../main/lambda/handlers/utils/movie-validation';

const tmdbMovie = {
    id: 42,
    title: 'A Movie',
    genres: [{ name: 'Drama' }],
    vote_average: 7.2,
    runtime: 100,
    release_date: '2026-01-02',
    overview: 'A synopsis.',
    tagline: 'A tagline.',
    backdrop_path: null,
    poster_path: '/poster.jpg',
    credits: {
        cast: [{ name: 'Actor' }],
        crew: [{ name: 'Director', job: 'Director' }],
    },
    videos: { results: [{ site: 'YouTube', type: 'Trailer', key: 'abc' }] },
    release_dates: {
        results: [{ iso_3166_1: 'GB', release_dates: [{ certification: '12A' }] }],
    },
};

const movieRecord = {
    tmdbId: '42',
    slug: 'a-movie',
    title: 'A Movie',
    visible: true,
    isComingSoon: false,
    genres: ['Drama'],
    rating: '12A',
    score: 7.2,
    runtime: 100,
    releaseDate: '2026-01-02',
    poster: '/poster.jpg',
    still: '/still.jpg',
    starring: ['Actor'],
    director: 'Director',
    synopsis: 'A synopsis.',
    trailer: '',
    showtimes: { Monday: [{ screen: '1', time: '11:00' }] },
};

describe('movie payload validation', () => {
    it('accepts valid TMDB responses and rejects malformed optional properties', () => {
        expect(isTmdbMovieResponse(tmdbMovie)).toBe(true);

        const malformedValues: unknown[] = [
            { ...tmdbMovie, title: 42 },
            { ...tmdbMovie, genres: 'Drama' },
            { ...tmdbMovie, genres: [null] },
            { ...tmdbMovie, vote_average: '7.2' },
            { ...tmdbMovie, runtime: '100' },
            { ...tmdbMovie, release_date: 2026 },
            { ...tmdbMovie, overview: false },
            { ...tmdbMovie, tagline: false },
            { ...tmdbMovie, backdrop_path: false },
            { ...tmdbMovie, poster_path: false },
            { ...tmdbMovie, credits: { cast: [null] } },
            { ...tmdbMovie, videos: { results: [null] } },
            { ...tmdbMovie, release_dates: { results: [null] } },
        ];

        for (const value of malformedValues) {
            expect(isTmdbMovieResponse(value)).toBe(false);
        }
    });

    it('validates screen and showtime shapes', () => {
        expect(isScreenedShowtime({ screen: '1', time: '11:00' })).toBe(true);
        expect(isScreenedShowtime({ screen: '6', time: '11:00' })).toBe(false);
        expect(isScreenedShowtime({ screen: '1', time: '25:00' })).toBe(false);
        expect(isMovieShowtimes({ Monday: [{ screen: '1', time: '11:00' }] })).toBe(true);
        expect(isMovieShowtimes({ Monday: '11:00' })).toBe(false);
    });

    it('validates optional movie record metadata', () => {
        expect(isMovieRecord(movieRecord)).toBe(true);
        expect(isMovieRecord({
            ...movieRecord,
            collectionId: '123',
            sortTitle: 'A Movie',
        })).toBe(true);
        expect(isMovieRecord({ ...movieRecord, collectionId: 'not-a-number' })).toBe(false);
        expect(isMovieRecord({ ...movieRecord, sortTitle: '   ' })).toBe(false);
    });
});
