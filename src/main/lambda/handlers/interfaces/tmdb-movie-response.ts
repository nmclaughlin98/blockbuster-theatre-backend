import type { TmdbCredits } from './tmdb-credits';
import type { TmdbMovieCollectionSummary } from './tmdb-movie-collection-summary';
import type { TmdbGenre } from './tmdb-genre';
import type { TmdbReleaseDates } from './tmdb-release-dates';
import type { TmdbVideos } from './tmdb-videos';

export interface TmdbMovieResponse {
    id: number;
    title?: string;
    genres?: TmdbGenre[];
    vote_average?: number;
    runtime?: number;
    release_date?: string;
    overview?: string;
    tagline?: string;
    backdrop_path?: string | null;
    poster_path?: string | null;
    credits?: TmdbCredits;
    videos?: TmdbVideos;
    release_dates?: TmdbReleaseDates;
    belongs_to_collection?: TmdbMovieCollectionSummary | null;
}
