import type {
    MovieRecord,
    MovieShowtimes,
    ScreenedShowtime,
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
} from '../interfaces';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
    return value === undefined || typeof value === 'boolean';
}

function isOptionalString(value: unknown): value is string | undefined {
    return value === undefined || typeof value === 'string';
}

function isOptionalNullableString(value: unknown): value is string | null | undefined {
    return value === undefined || value === null || typeof value === 'string';
}

function isOptionalNumber(value: unknown): value is number | undefined {
    return value === undefined || typeof value === 'number';
}

function isOptionalArray<T>(
    value: unknown,
    isItem: (item: unknown) => item is T
): value is T[] | undefined {
    return value === undefined || (Array.isArray(value) && value.every(isItem));
}

function isTmdbGenre(value: unknown): value is TmdbGenre {
    return isRecord(value) && typeof value.name === 'string';
}

function isTmdbCastMember(value: unknown): value is TmdbCastMember {
    return isRecord(value) && isOptionalNullableString(value.name);
}

function isTmdbCrewMember(value: unknown): value is TmdbCrewMember {
    return isRecord(value) &&
        isOptionalNullableString(value.name) &&
        isOptionalNullableString(value.job);
}

function isTmdbVideo(value: unknown): value is TmdbVideo {
    return isRecord(value) &&
        isOptionalString(value.site) &&
        isOptionalString(value.type) &&
        isOptionalString(value.key);
}

function isTmdbReleaseCertification(value: unknown): value is TmdbReleaseCertification {
    return isRecord(value) && isOptionalNullableString(value.certification);
}

function isTmdbCountryRelease(value: unknown): value is TmdbCountryRelease {
    return isRecord(value) &&
        isOptionalString(value.iso_3166_1) &&
        isOptionalArray(value.release_dates, isTmdbReleaseCertification);
}

function isTmdbCredits(value: unknown): value is TmdbCredits {
    return isRecord(value) &&
        isOptionalArray(value.cast, isTmdbCastMember) &&
        isOptionalArray(value.crew, isTmdbCrewMember);
}

function isTmdbVideos(value: unknown): value is TmdbVideos {
    return isRecord(value) && isOptionalArray(value.results, isTmdbVideo);
}

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
        isOptionalString(value.tagline) &&
        isOptionalNullableString(value.backdrop_path) &&
        isOptionalNullableString(value.poster_path) &&
        (value.credits === undefined || isTmdbCredits(value.credits)) &&
        (value.videos === undefined || isTmdbVideos(value.videos)) &&
        (value.release_dates === undefined || isTmdbReleaseDates(value.release_dates));
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function isScreenedShowtime(value: unknown): value is ScreenedShowtime {
    return (
        isRecord(value) &&
        Object.keys(value).every((key) => ['showtimeId', 'screen', 'time'].includes(key)) &&
        Object.keys(value).length >= 2 &&
        (value.showtimeId === undefined ||
            (typeof value.showtimeId === 'string' &&
                /^show_\d+_(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)_[1-5]_(?:[01]\d|2[0-3])[0-5]\d$/.test(
                    value.showtimeId
                ))) &&
        typeof value.screen === 'string' &&
        /^[1-5]$/.test(value.screen) &&
        typeof value.time === 'string' &&
        /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.time)
    );
}

export function isMovieShowtimes(value: unknown): value is MovieShowtimes {
    return (
        isRecord(value) &&
        Object.values(value).every(
            (showings) =>
                Array.isArray(showings) && showings.every(isScreenedShowtime)
        )
    );
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
        (
            value.collectionId === undefined ||
            (typeof value.collectionId === 'string' && /^\d+$/.test(value.collectionId))
        ) &&
        (
            value.sortTitle === undefined ||
            (typeof value.sortTitle === 'string' && Boolean(value.sortTitle.trim()))
        ) &&
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
        isMovieShowtimes(value.showtimes)
    );
}
