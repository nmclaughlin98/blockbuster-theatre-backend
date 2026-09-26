export interface MovieSummary {
    slug: string;
    movieId: number;
    title: string;
    visible: boolean;
    isComingSoon: boolean;
    poster: string;
    rating: string;
    runtime: number;
    genres: string[];
    releaseDate: string;
    score: number;
}
