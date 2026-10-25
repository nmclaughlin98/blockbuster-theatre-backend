export interface ScreenedShowtime {
    /** Generated deterministically from movie, weekday, screen, and time for API responses. */
    showtimeId?: string;
    screen: '1' | '2' | '3' | '4' | '5';
    time: string;
}

export type MovieShowtimes = Record<string, ScreenedShowtime[]>;
