export interface MovieRecord {
    tmdbId: string;
    slug: string;
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
    largePoster: string;
    still: string;
    largeStill: string;
    starring: string[];
    director: string;
    synopsis: string;
    tagline: string;
    trailer: string;
    showtimes: Record<string, string[]>;
}
