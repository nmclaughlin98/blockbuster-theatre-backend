/** One booked seat. Seats are stored individually so a seat can only be booked once per screening. */
export interface BookingRecord {
    /** Stable random ID identifying one dated screening. */
    showtimeId: string;
    seatId: string;
    bookingId: string;
    recordType: 'SEAT';
    userId: string;
    movieId: string;
    /** Showing date, YYYY-MM-DD. */
    date: string;
    screen: string;
    time: string;
    bookedAt: string;
}
