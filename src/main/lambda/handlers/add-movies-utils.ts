import { APIGatewayProxyResultV2 } from 'aws-lambda';

export interface ProcessResult {
    id: string;
    status: 'SUCCESS' | 'FAILED';
    title?: string;
    error?: string;
}

export interface MovieData {
    slug: string;
    movieId: number;
    title: string;
    genres: string[];
    genre: string;
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

type LogLevel = 'INFO' | 'WARN' | 'ERROR';

export function intEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`Invalid env var ${name}=${raw}`);
    }
    return value;
}

const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'OPTIONS,POST',
};

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

export function projectTmdb(raw: any): MovieData {
    const genres: string[] = Array.isArray(raw.genres)
        ? raw.genres.map((genre: any) => genre.name)
        : [];

    const credits = raw.credits || {};
    const cast: any[] = Array.isArray(credits.cast) ? credits.cast : [];
    const crew: any[] = Array.isArray(credits.crew) ? credits.crew : [];
    const starring = cast.slice(0, 5).map((member) => member.name);
    const director = crew.find((member) => member.job === 'Director')?.name ?? 'Unknown';
    const showtimes = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
        .reduce<Record<string, string[]>>((schedule, day) => {
            schedule[day] = ['11:00', '13:00', '15:00', '19:00'];
            return schedule;
        }, {});

    return {
        slug: slugify(raw.title || ''),
        movieId: raw.id,
        title: raw.title || 'Untitled',
        genres,
        genre: genres[0] || 'Uncategorized',
        rating: 'PG',
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
        trailer: '',
        poster: raw.poster_path
            ? `https://image.tmdb.org/t/p/w1280${raw.poster_path}`
            : '',
        showtimes,
    };
}
