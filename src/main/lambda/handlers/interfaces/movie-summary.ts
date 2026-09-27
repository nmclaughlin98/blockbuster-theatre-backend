export interface MovieSummary {
    slug: string;
    movieId: number;
    title: string;
    visible: boolean;
    isComingSoon: boolean;
    isCarousel: boolean;
    poster: string;
    rating: string;
    runtime: number;
    genres: string[];
    releaseDate: string;
    score: number;
    showtimes: Record<string, string[]>;
}
