import type { TmdbReleaseCertification } from './tmdb-release-certification';

export interface TmdbCountryRelease {
    iso_3166_1?: string;
    release_dates?: TmdbReleaseCertification[];
}
