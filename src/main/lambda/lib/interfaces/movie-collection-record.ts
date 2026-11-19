export interface MovieCollectionRecord {
    collectionId: string;
    name: string;
    description: string;
    posterUrl: string;
    backdropUrl: string;
    movieIds: string[];
    isActive?: boolean;
    lastUpdated?: string;
}
