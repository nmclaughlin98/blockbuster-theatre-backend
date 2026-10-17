import type {
    MovieCollectionRecord,
} from '../interfaces';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isMovieCollectionRecord(value: unknown): value is MovieCollectionRecord {
    return isRecord(value) &&
        typeof value.collectionId === 'string' &&
        /^\d+$/.test(value.collectionId) &&
        typeof value.name === 'string' &&
        typeof value.description === 'string' &&
        typeof value.posterUrl === 'string' &&
        typeof value.backdropUrl === 'string' &&
        Array.isArray(value.movieIds) &&
        value.movieIds.every((id) => typeof id === 'string' && /^\d+$/.test(id)) &&
        (value.lastUpdated === undefined || typeof value.lastUpdated === 'string');
}
