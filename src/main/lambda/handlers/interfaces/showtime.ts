export interface ScreenedShowtime {
    /** Stable random ID for one dated screening, e.g. 559924_2026-10-25_1215. */
    showtimeId?: string;
    /** Calendar date of this screening, YYYY-MM-DD. */
    date?: string;
    screen: '1' | '2' | '3' | '4' | '5';
    time: string;
}

export type MovieShowtimes = Record<string, ScreenedShowtime[]>;
