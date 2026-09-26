export interface MovieData {
    slug: string;
    movieId: number;
    title: string;
    genres: string[];
    rating: string;
    score: number;
    runtime: number;
    releaseDate: string;
    visible: boolean;
    starring: string[];
    director: string;
    synopsis: string;
    still: string;
    trailer: string;
    poster: string;
    showtimes: Record<string, string[]>;
}
