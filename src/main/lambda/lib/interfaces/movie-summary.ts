import type { MovieShowtimes } from './showtime';

export type MovieLifecycleStatus =
    'Now Showing' | 'Coming Soon (Pre-Sales Open)' | 'Coming Soon (No Showtimes Yet)' | 'Ended';

export interface MovieSummary {
    slug: string;
    sortTitle: string;
    movieId: number;
    title: string;
    visible: boolean;
    isComingSoon: boolean;
    lifecycleStatus: MovieLifecycleStatus;
    isCarousel: boolean;
    trailer: string;
    still: string;
    synopsis: string;
    tagline: string;
    poster: string;
    rating: string;
    runtime: number;
    genres: string[];
    mainGenre: string;
    releaseDate: string;
    startDate: string;
    runEndDate?: string;
    preSalesEligible: boolean;
    score: number;
    showtimes: MovieShowtimes;
}
