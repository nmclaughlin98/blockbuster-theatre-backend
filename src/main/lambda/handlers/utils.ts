import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import type {
    MovieDetail,
    MovieData,
    MovieRecord,
    MovieSummary,
    TmdbCastMember,
    TmdbCountryRelease,
    TmdbCredits,
    TmdbCrewMember,
    TmdbGenre,
    TmdbMovieResponse,
    TmdbReleaseCertification,
    TmdbReleaseDates,
    TmdbVideo,
    TmdbVideos,
} from './interfaces';

type LogLevel = 'INFO' | 'WARN' | 'ERROR';
type UnknownRecord = Record<string, unknown>;

const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'OPTIONS,POST',
};

/**
 * Reads a positive integer from an environment variable.
 * @param name Environment variable name.
 * @param fallback Value to use when the variable is unset.
 * @returns The configured integer or fallback.
 * @throws If the configured value is not a positive integer.
 */
export function intEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`Invalid env var ${name}=${raw}`);
    }
    return value;
}

/**
 * Creates an API Gateway JSON response with the shared CORS headers.
 * @param statusCode HTTP response status.
 * @param body Value to serialize as JSON.
 * @returns The API Gateway response.
 */
export function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
    return { statusCode, headers, body: JSON.stringify(body) };
}

/**
 * Waits for the requested duration.
 * @param ms Delay in milliseconds.
 * @returns A promise resolved after the delay.
 */
export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Writes a structured log entry at the requested severity.
 * @param level Log severity.
 * @param message Log message.
 * @param meta Optional fields to include in the log entry.
 */
export function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    const entry = {
        level,
        message,
        timestamp: new Date().toISOString(),
        ...meta,
    };
    const line = JSON.stringify(entry);
    if (level === 'ERROR') {
        console.error(line);
    } else if (level === 'WARN') {
        console.warn(line);
    } else {
        console.log(line);
    }
}

/**
 * Maps items in parallel while preserving result order and limiting concurrency.
 * @param items Items to process.
 * @param limit Maximum number of concurrent operations.
 * @param fn Async operation applied to each item.
 * @returns Results in the same order as the input items.
 */
export async function mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;

    /** Processes the next available item until the input is exhausted. */
    async function worker(): Promise<void> {
        while (true) {
            const index = next++;
            if (index >= items.length) return;
            results[index] = await fn(items[index]);
        }
    }

    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}

/**
 * Trims and deduplicates movie IDs and identifies non-numeric values.
 * @param movieIds Raw values supplied by the caller.
 * @returns Normalized IDs and IDs that are not numeric.
 */
export function normalizeMovieIds(movieIds: unknown[]): { ids: string[]; invalid: string[] } {
    const ids = [...new Set(movieIds.map((raw) => String(raw).trim()).filter(Boolean))];
    return {
        ids,
        invalid: ids.filter((id) => !/^\d+$/.test(id)),
    };
}

/** Checks whether an optional value is a boolean. */
function isOptionalBoolean(value: unknown): value is boolean | undefined {
    return value === undefined || typeof value === 'boolean';
}

/** Converts a title into a URL-friendly slug. */
function slugify(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-');
}

/** Narrows an unknown value to a non-array object. */
function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Checks whether an optional value is a string. */
function isOptionalString(value: unknown): value is string | undefined {
    return value === undefined || typeof value === 'string';
}

/** Checks whether an optional value is a string or null. */
function isOptionalNullableString(value: unknown): value is string | null | undefined {
    return value === undefined || value === null || typeof value === 'string';
}

/** Checks whether an optional value is a number. */
function isOptionalNumber(value: unknown): value is number | undefined {
    return value === undefined || typeof value === 'number';
}

/** Checks whether an optional array contains only values accepted by a guard. */
function isOptionalArray<T>(
    value: unknown,
    isItem: (item: unknown) => item is T
): value is T[] | undefined {
    return value === undefined || (Array.isArray(value) && value.every(isItem));
}

/** Validates a TMDB genre object. */
function isTmdbGenre(value: unknown): value is TmdbGenre {
    return isRecord(value) && typeof value.name === 'string';
}

/** Validates a TMDB cast member object. */
function isTmdbCastMember(value: unknown): value is TmdbCastMember {
    return isRecord(value) && isOptionalNullableString(value.name);
}

/** Validates a TMDB crew member object. */
function isTmdbCrewMember(value: unknown): value is TmdbCrewMember {
    return isRecord(value) &&
        isOptionalNullableString(value.name) &&
        isOptionalNullableString(value.job);
}

/** Validates a TMDB video object. */
function isTmdbVideo(value: unknown): value is TmdbVideo {
    return isRecord(value) &&
        isOptionalString(value.site) &&
        isOptionalString(value.type) &&
        isOptionalString(value.key);
}

/** Validates a TMDB release certification object. */
function isTmdbReleaseCertification(value: unknown): value is TmdbReleaseCertification {
    return isRecord(value) && isOptionalNullableString(value.certification);
}

/** Validates a TMDB country release object. */
function isTmdbCountryRelease(value: unknown): value is TmdbCountryRelease {
    return isRecord(value) &&
        isOptionalString(value.iso_3166_1) &&
        isOptionalArray(value.release_dates, isTmdbReleaseCertification);
}

/** Validates the credits section of a TMDB movie response. */
function isTmdbCredits(value: unknown): value is TmdbCredits {
    return isRecord(value) &&
        isOptionalArray(value.cast, isTmdbCastMember) &&
        isOptionalArray(value.crew, isTmdbCrewMember);
}

/** Validates the videos section of a TMDB movie response. */
function isTmdbVideos(value: unknown): value is TmdbVideos {
    return isRecord(value) && isOptionalArray(value.results, isTmdbVideo);
}

/** Validates the release dates section of a TMDB movie response. */
function isTmdbReleaseDates(value: unknown): value is TmdbReleaseDates {
    return isRecord(value) && isOptionalArray(value.results, isTmdbCountryRelease);
}

/**
 * Checks that an unknown API payload has the supported TMDB movie response shape.
 * @param value Parsed TMDB response payload.
 * @returns True when the payload can safely be treated as a TMDB movie response.
 */
export function isTmdbMovieResponse(value: unknown): value is TmdbMovieResponse {
    return isRecord(value) &&
        typeof value.id === 'number' &&
        isOptionalString(value.title) &&
        isOptionalArray(value.genres, isTmdbGenre) &&
        isOptionalNumber(value.vote_average) &&
        isOptionalNumber(value.runtime) &&
        isOptionalString(value.release_date) &&
        isOptionalString(value.overview) &&
        isOptionalNullableString(value.backdrop_path) &&
        isOptionalNullableString(value.poster_path) &&
        (value.credits === undefined || isTmdbCredits(value.credits)) &&
        (value.videos === undefined || isTmdbVideos(value.videos)) &&
        (value.release_dates === undefined || isTmdbReleaseDates(value.release_dates));
}

/** Checks whether every item in an array is a string. */
function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Validates a weekly showtimes map. */
function isShowtimes(value: unknown): value is Record<string, string[]> {
    return isRecord(value) && Object.values(value).every(isStringArray);
}

/**
 * Checks whether a DynamoDB item contains the fields required by movie responses.
 * @param value Untrusted DynamoDB item.
 * @returns True when the item conforms to the stored movie shape.
 */
export function isMovieRecord(value: unknown): value is MovieRecord {
    return (
        isRecord(value) &&
        typeof value.tmdbId === 'string' &&
        /^\d+$/.test(value.tmdbId) &&
        typeof value.slug === 'string' &&
        typeof value.title === 'string' &&
        typeof value.visible === 'boolean' &&
        isOptionalBoolean(value.isComingSoon) &&
        isStringArray(value.genres) &&
        typeof value.rating === 'string' &&
        typeof value.score === 'number' &&
        typeof value.runtime === 'number' &&
        typeof value.releaseDate === 'string' &&
        typeof value.poster === 'string' &&
        typeof value.still === 'string' &&
        isStringArray(value.starring) &&
        typeof value.director === 'string' &&
        typeof value.synopsis === 'string' &&
        typeof value.trailer === 'string' &&
        isShowtimes(value.showtimes)
    );
}

/**
 * Projects a stored movie into the compact now-showing list shape.
 * @param movie Stored movie record.
 * @returns Movie summary with a date-only release date.
 */
export function projectMovieSummary(movie: MovieRecord): MovieSummary {
    return {
        slug: movie.slug,
        movieId: Number(movie.tmdbId),
        title: movie.title,
        visible: movie.visible,
        isComingSoon: movie.isComingSoon ?? false,
        poster: movie.poster,
        rating: movie.rating,
        runtime: movie.runtime,
        genres: movie.genres,
        releaseDate: movie.releaseDate.slice(0, 10),
        score: movie.score,
        showtimes: movie.showtimes,
    };
}

/**
 * Projects a stored movie into the full movie-detail response shape.
 * @param movie Stored movie record.
 * @returns Full movie detail, including the primary genre.
 */
export function projectMovieDetail(movie: MovieRecord): MovieDetail {
    return {
        slug: movie.slug,
        movieId: Number(movie.tmdbId),
        title: movie.title,
        visible: movie.visible,
        isComingSoon: movie.isComingSoon ?? false,
        genres: movie.genres,
        genre: movie.genres[0] ?? 'Uncategorized',
        rating: movie.rating,
        score: movie.score,
        runtime: movie.runtime,
        releaseDate: movie.releaseDate,
        poster: movie.poster,
        still: movie.still,
        starring: movie.starring,
        director: movie.director,
        synopsis: movie.synopsis,
        trailer: movie.trailer,
        showtimes: movie.showtimes,
    };
}

/**
 * Converts a TMDB movie response into the shape stored by the application.
 * @param raw Validated TMDB movie response.
 * @param isComingSoon Whether the imported movie should be marked as upcoming.
 * @returns Movie data ready to persist.
 */
export function projectTmdb(raw: TmdbMovieResponse, isComingSoon = false): MovieData {
    const genres = raw.genres?.map((genre) => genre.name) ?? [];
    const cast = raw.credits?.cast ?? [];
    const crew = raw.credits?.crew ?? [];
    const starring = cast
        .slice(0, 5)
        .map((member) => member.name)
        .filter((name): name is string => typeof name === 'string');
    const director = crew
        .filter(
            (member): member is TmdbCrewMember & { name: string } =>
                member.job === 'Director' &&
                typeof member.name === 'string' &&
                Boolean(member.name.trim())
        )
        .slice(0, 3)
        .map((member) => member.name.trim())
        .join(', ') || 'Unknown';
    const showtimes = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
        .reduce<Record<string, string[]>>((schedule, day) => {
            schedule[day] = ['11:00', '13:00', '15:00', '19:00'];
            return schedule;
        }, {});
    const trailerKey = raw.videos?.results?.find(
        (video) => video.site === 'YouTube' && video.type === 'Trailer' && video.key
    )?.key;
    const ukRelease = raw.release_dates?.results?.find(
        (release) => release.iso_3166_1 === 'GB'
    );
    const rating = ukRelease?.release_dates?.[0]?.certification || 'PG';

    return {
        slug: slugify(raw.title || ''),
        movieId: raw.id,
        title: raw.title || 'Untitled',
        genres,
        rating,
        score: raw.vote_average ? Number(raw.vote_average.toFixed(1)) : 0,
        runtime: raw.runtime || 0,
        releaseDate: raw.release_date ? `${raw.release_date}T00:00:00.000Z` : '',
        visible: true,
        isComingSoon,
        starring,
        director,
        synopsis: raw.overview || '',
        still: raw.backdrop_path
            ? `https://image.tmdb.org/t/p/w1920${raw.backdrop_path}`
            : '',
        trailer: trailerKey
            ? `https://www.youtube-nocookie.com/embed/${trailerKey}?rel=0`
            : '',
        poster: raw.poster_path
            ? `https://image.tmdb.org/t/p/w1280${raw.poster_path}`
            : '',
        showtimes
    };
}
