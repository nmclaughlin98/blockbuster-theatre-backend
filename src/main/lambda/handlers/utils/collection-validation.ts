import type {
    MovieCollectionInput,
    MovieCollectionRecord,
} from '../interfaces';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCollectionId(value: unknown): value is string {
    return typeof value === 'string' && /^\d+$/.test(value);
}

export function isMovieCollectionInput(value: unknown): value is MovieCollectionInput {
    return isRecord(value) &&
        isCollectionId(value.collectionId) &&
        typeof value.name === 'string' &&
        Boolean(value.name.trim()) &&
        typeof value.overview === 'string' &&
        typeof value.poster === 'string' &&
        typeof value.backdrop === 'string' &&
        (value.parentCollectionId === undefined || isCollectionId(value.parentCollectionId)) &&
        (
            value.sortOrder === undefined ||
            (
                Number.isSafeInteger(value.sortOrder) &&
                typeof value.sortOrder === 'number' &&
                value.sortOrder >= 0
            )
        );
}

export function isMovieCollectionRecord(value: unknown): value is MovieCollectionRecord {
    return isRecord(value) &&
        isCollectionId(value.collectionId) &&
        typeof value.name === 'string' &&
        typeof value.overview === 'string' &&
        typeof value.poster === 'string' &&
        typeof value.backdrop === 'string' &&
        (value.parentCollectionId === undefined || isCollectionId(value.parentCollectionId)) &&
        Number.isSafeInteger(value.sortOrder) &&
        typeof value.sortOrder === 'number' &&
        value.sortOrder >= 0 &&
        (value.GSI1PK === undefined || typeof value.GSI1PK === 'string') &&
        (value.GSI1SK === undefined || typeof value.GSI1SK === 'string');
}
