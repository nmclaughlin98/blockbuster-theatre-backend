import type {
    MovieData,
    MovieDetail,
    MovieRecord,
    MovieSummary,
    TmdbCrewMember,
    TmdbMovieResponse,
} from '../interfaces';
import { TMDB_MOVIE_METADATA_OVERRIDES } from './movie-metadata-overrides';

function slugify(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/[\s_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function isValidSlug(value: string): boolean {
    return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function checkIsComingSoon(releaseDateString: string): boolean {
    const releaseDate = new Date(releaseDateString);
    const dateToday = new Date();

    return dateToday < releaseDate;
}

/**
 * Projects a stored movie into the compact now-showing list shape.
 * @param movie Stored movie record.
 * @returns Movie summary with a date-only release date.
 */
export function projectMovieSummary(movie: MovieRecord): MovieSummary {
    return {
        slug: movie.slug,
        sortTitle: movie.sortTitle ?? movie.title,
        movieId: Number(movie.tmdbId),
        ...(movie.collectionId !== undefined && { collectionId: movie.collectionId }),
        title: movie.title,
        visible: movie.visible,
        isComingSoon: movie.isComingSoon ?? false,
        isCarousel: movie.isCarousel ?? false,
        trailer: movie.trailer,
        synopsis: movie.synopsis,
        tagline: movie.tagline,
        still: movie.still,
        largeStill: movie.largeStill,
        poster: movie.poster,
        rating: movie.rating,
        runtime: movie.runtime,
        genres: movie.genres,
        mainGenre: movie.mainGenre,
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
        sortTitle: movie.sortTitle ?? movie.title,
        movieId: Number(movie.tmdbId),
        ...(movie.collectionId !== undefined && { collectionId: movie.collectionId }),
        title: movie.title,
        visible: movie.visible,
        isComingSoon: movie.isComingSoon ?? false,
        genres: movie.genres,
        mainGenre: movie.mainGenre,
        rating: movie.rating,
        score: movie.score,
        runtime: movie.runtime,
        releaseDate: movie.releaseDate,
        poster: movie.poster,
        largePoster: movie.largePoster,
        largeStill: movie.largeStill,
        still: movie.still,
        starring: movie.starring,
        director: movie.director,
        synopsis: movie.synopsis,
        tagline: movie.tagline,
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
export function projectTmdb(
    raw: TmdbMovieResponse,
    isComingSoon?: boolean
): MovieData {
    const metadataOverride = TMDB_MOVIE_METADATA_OVERRIDES[raw.id];
    const title = metadataOverride?.title || raw.title || 'Untitled';
    const generatedSlug = slugify(metadataOverride?.slug || raw.title || '');
    const slug = isValidSlug(generatedSlug) ? generatedSlug : String(raw.id);
    const genres = raw.genres?.map((genre) => genre.name) ?? [];
    const cast = raw.credits?.cast ?? [];
    const crew = raw.credits?.crew ?? [];
    const starring = cast
        .slice(0, 10)
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
        slug,
        sortTitle: metadataOverride?.sortTitle || title,
        movieId: raw.id,
        ...(raw.belongs_to_collection && {
            collectionId: String(raw.belongs_to_collection.id),
        }),
        title,
        genres,
        mainGenre: genres[0] ?? 'Uncategorized',
        rating,
        score: raw.vote_average ? Number(raw.vote_average.toFixed(1)) : 0,
        runtime: raw.runtime || 0,
        releaseDate: raw.release_date ? `${raw.release_date}T00:00:00.000Z` : '',
        visible: true,
        isCarousel: false,
        isComingSoon: isComingSoon ?? checkIsComingSoon(raw.release_date || ''),
        starring,
        director,
        synopsis: raw.overview || '',
        tagline: raw.tagline || '',
        still: raw.backdrop_path
            ? `https://image.tmdb.org/t/p/w1280${raw.backdrop_path}`
            : '',
        largeStill: raw.backdrop_path
            ? `https://image.tmdb.org/t/p/original${raw.backdrop_path}`
            : '',
        trailer: trailerKey
            ? `https://www.youtube-nocookie.com/embed/${trailerKey}?rel=0`
            : '',
        poster: raw.poster_path
            ? `https://image.tmdb.org/t/p/w500${raw.poster_path}`
            : '',
        largePoster: raw.poster_path
            ? `https://image.tmdb.org/t/p/original${raw.poster_path}`
            : '',
        showtimes,
    };
}
