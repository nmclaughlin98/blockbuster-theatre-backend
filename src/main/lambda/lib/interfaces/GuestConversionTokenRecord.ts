export interface GuestConversionTokenRecord {
    tokenHash: string;
    bookingId: string;
    showtimeId?: string;
    showingId?: string;
    customerEmail: string;
    expiresAt: number;
    consumedAt?: string;
    userId?: string;
}
