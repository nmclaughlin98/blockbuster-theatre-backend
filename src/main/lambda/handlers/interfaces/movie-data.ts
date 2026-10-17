export interface MovieData {
    slug: string;
    sortTitle: string;
    movieId: number;
    title: string;
    genres: string[];
    mainGenre: string;
    rating: string;
    score: number;
    runtime: number;
    releaseDate: string;
    visible: boolean;
    isComingSoon: boolean;
    isCarousel: boolean;
    starring: string[];
    director: string;
    synopsis: string;
    tagline: string;
    still: string;
    trailer: string;
    poster: string;
    showtimes: Record<string, string[]>;
}
