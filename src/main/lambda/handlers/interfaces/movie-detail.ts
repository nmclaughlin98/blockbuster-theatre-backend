export interface MovieDetail {
    slug: string;
    sortTitle: string;
    movieId: number;
    title: string;
    visible: boolean;
    isComingSoon: boolean;
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
    showtimes: Record<string, string[]>;
}
