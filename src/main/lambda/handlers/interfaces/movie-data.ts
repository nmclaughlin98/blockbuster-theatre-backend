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
    isComingSoon: boolean;
    isCarousel: boolean;
    starring: string[];
    director: string;
    synopsis: string;
    still: string;
    largeStill: string;
    trailer: string;
    poster: string;
    largePoster: string;
    showtimes: Record<string, string[]>;
}
