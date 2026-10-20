export interface ScreenedShowtime {
    screen: '1' | '2' | '3' | '4' | '5';
    time: string;
}

export type MovieShowtimes = Record<string, ScreenedShowtime[]>;
