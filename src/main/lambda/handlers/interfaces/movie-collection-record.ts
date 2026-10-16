export interface MovieCollectionRecord {
    collectionId: string;
    name: string;
    overview: string;
    poster: string;
    backdrop: string;
    parentCollectionId?: string;
    sortOrder?: number;
    GSI1PK?: string;
    GSI1SK?: string;
    lastUpdated?: string;
}
