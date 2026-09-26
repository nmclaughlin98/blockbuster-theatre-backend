import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import type {
    MovieData,
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

export function intEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`Invalid env var ${name}=${raw}`);
    }
    return value;
}

export function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
    return { statusCode, headers, body: JSON.stringify(body) };
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

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

export async function mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;

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

export function normalizeMovieIds(movieIds: unknown[]): { ids: string[]; invalid: string[] } {
    const ids = [...new Set(movieIds.map((raw) => String(raw).trim()).filter(Boolean))];
    return {
        ids,
        invalid: ids.filter((id) => !/^\d+$/.test(id)),
    };
}

function slugify(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-');
}

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
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

export function projectTmdb(raw: TmdbMovieResponse): MovieData {
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
        showtimes,
    };
}
