import type { MovieLifecycleStatus } from './movie-summary';
import type { MovieShowtimes } from './showtime';

export interface MovieDetail {
    slug: string;
    sortTitle: string;
    movieId: number;
    title: string;
    visible: boolean;
    isComingSoon: boolean;
    lifecycleStatus: MovieLifecycleStatus;
    genres: string[];
    mainGenre: string;
    rating: string;
    score: number;
    runtime: number;
    releaseDate: string;
    startDate: string;
    runEndDate?: string;
    preSalesEligible: boolean;
    poster: string;
    still: string;
    starring: string[];
    director: string;
    synopsis: string;
    tagline: string;
    trailer: string;
    showtimes: MovieShowtimes;
}
