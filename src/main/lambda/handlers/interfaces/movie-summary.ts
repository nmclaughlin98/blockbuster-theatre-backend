import type { MovieShowtimes } from './showtime';

export interface MovieSummary {
    slug: string;
    sortTitle: string;
    movieId: number;
    title: string;
    visible: boolean;
    isComingSoon: boolean;
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
    score: number;
    showtimes: MovieShowtimes;
}
