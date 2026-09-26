export interface MovieDetail {
    slug: string;
    movieId: number;
    title: string;
    visible: boolean;
    isComingSoon: boolean;
    genres: string[];
    genre: string;
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
