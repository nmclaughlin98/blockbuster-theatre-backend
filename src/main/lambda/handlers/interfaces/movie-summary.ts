export interface MovieSummary {
    slug: string;
    movieId: number;
    title: string;
    visible: boolean;
    isComingSoon: boolean;
    isCarousel: boolean;
    trailer: string;
    still: string;
    synopsis: string;
    poster: string;
    rating: string;
    runtime: number;
    genres: string[];
    releaseDate: string;
    score: number;
    showtimes: Record<string, string[]>;
}
