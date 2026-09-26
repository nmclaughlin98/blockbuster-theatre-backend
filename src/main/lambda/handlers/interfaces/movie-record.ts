export interface MovieRecord {
    tmdbId: string;
    slug: string;
    title: string;
    visible: boolean;
    isComingSoon?: boolean;
    genres: string[];
    rating: string;
    score: number;
    runtime: number;
    releaseDate: string;
    poster: string;
    still: string;
    starring: string[];
    director: string;
    synopsis: string;
    trailer: string;
    showtimes: Record<string, string[]>;
}
