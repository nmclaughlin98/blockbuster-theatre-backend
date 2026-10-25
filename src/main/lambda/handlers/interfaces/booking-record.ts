/** One booked seat. Seats are stored individually so a seat can only be booked once per showing. */
export interface BookingRecord {
    /** `${movieId}#${date}#${time}` — identifies a single showing on a specific date. */
    showingId: string;
    seatId: string;
    bookingId: string;
    userId: string;
    movieId: string;
    /** Showing date, YYYY-MM-DD. */
    date: string;
    time: string;
    bookedAt: string;
}
