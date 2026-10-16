export interface MovieCollectionInput {
    collectionId: string;
    name: string;
    overview: string;
    poster: string;
    backdrop: string;
    parentCollectionId?: string;
    sortOrder?: number;
}
