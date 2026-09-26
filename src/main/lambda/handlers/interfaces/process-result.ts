export interface ProcessResult {
    id: string;
    status: 'SUCCESS' | 'FAILED';
    title?: string;
    error?: string;
}
