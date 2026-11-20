import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { InvalidAuthorizationError, json, log, type OptionalJwtEvent } from '../../main/lambda/handlers/utils/common';
import { generateTicketPdf, type TicketPdfInput } from '../../main/lambda/handlers/utils/ticket-pdf-generator';
import { authorizeBooking } from './get-booking-record';

class TicketDataError extends Error {}

function ticketDetails(booking: Record<string, unknown>): TicketPdfInput {
    const { bookingRef, movieTitle, date, time, screen, seats, customerName, tickets, totalAmount, currency } = booking;
    const parsedDate = typeof date === 'string' ? new Date(`${date}T00:00:00Z`) : new Date(NaN);
    if (typeof bookingRef !== 'string' || !bookingRef.trim()
        || typeof movieTitle !== 'string' || !movieTitle.trim()
        || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)
        || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date
        || typeof time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)
        || typeof screen !== 'string' || !screen.trim()
        || !Array.isArray(seats) || seats.length === 0
        || seats.some((seat: unknown) => typeof seat !== 'string' || !seat.trim())
        || new Set(seats).size !== seats.length
        || typeof customerName !== 'string' || !customerName.trim()
        || !Array.isArray(tickets) || tickets.length === 0
        || typeof totalAmount !== 'number' || !Number.isFinite(totalAmount) || totalAmount < 0
        || typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) {
        throw new TicketDataError('The booking contains invalid ticket details.');
    }

    let ticketCount = 0;
    for (const ticket of tickets as unknown[]) {
        if (typeof ticket !== 'object' || ticket === null || !('quantity' in ticket)
            || typeof ticket.quantity !== 'number'
            || !Number.isSafeInteger(ticket.quantity) || ticket.quantity < 1) {
            throw new TicketDataError('The booking contains invalid ticket quantities.');
        }
        ticketCount += ticket.quantity;
    }
    if (!Number.isSafeInteger(ticketCount) || ticketCount !== seats.length) {
        throw new TicketDataError('The booking ticket quantities do not match its seats.');
    }

    return {
        bookingRef, movieTitle, date, time, screen, seats,
        guestName: customerName, ticketCount, totalAmount, currency,
    };
}

export async function handler(event: OptionalJwtEvent): Promise<APIGatewayProxyResultV2> {
    const bookingId = event.pathParameters?.bookingId;
    if (!bookingId?.trim()) {
        return json(400, { message: 'A booking ID is required.' });
    }

    try {
        const booking = await authorizeBooking(event);
        if (!booking) return json(404, { message: 'Booking not found.' });
        const details = ticketDetails(booking);
        const pdf = await generateTicketPdf(details);
        return {
            statusCode: 200,
            isBase64Encoded: true,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="${details.movieTitle.replace(/[^a-zA-Z0-9_-]/g, '_')}_${details.bookingRef.replace(/[^a-zA-Z0-9_-]/g, '-')}.pdf"`,
                'Content-Length': String(pdf.length),
                'Cache-Control': 'no-store',
            },
            body: pdf.toString('base64'),
        };
    } catch (error: unknown) {
        if (error instanceof InvalidAuthorizationError) return json(401, { message: error.message });
        log('ERROR', 'Failed to download booking ticket', {
            requestId: event.requestContext.requestId,
            errorName: error instanceof Error ? error.name : 'UnknownError',
            ...(error instanceof TicketDataError && { reason: error.message }),
        });
        return json(500, { message: 'Unable to download booking ticket.' });
    }
}
