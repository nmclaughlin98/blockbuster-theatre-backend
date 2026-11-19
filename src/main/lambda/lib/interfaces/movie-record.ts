import type { MovieShowtimes } from './showtime';

export interface MovieRecord {
    tmdbId: string;
    slug: string;
    collectionId?: string;
    GSI2PK?: string;
    GSI2SK?: string;
    sortTitle?: string;
    title: string;
    visible: boolean;
    isComingSoon?: boolean;
    isCarousel?: boolean;
    genres: string[];
    mainGenre: string;
    rating: string;
    score: number;
    runtime: number;
    releaseDate: string;
    poster: string;
    still: string;
    starring: string[];
    director: string;
    synopsis: string;
    tagline: string;
    trailer: string;
    showtimes: MovieShowtimes;
}
