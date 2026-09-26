import type { TmdbCastMember } from './tmdb-cast-member';
import type { TmdbCrewMember } from './tmdb-crew-member';

export interface TmdbCredits {
    cast?: TmdbCastMember[];
    crew?: TmdbCrewMember[];
}
