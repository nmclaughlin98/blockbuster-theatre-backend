import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import type { BookingConfirmationEmail } from './utils/booking-confirmation-email';
import { sendBookingConfirmationEmail } from './booking-confirmation-service';
import { json, log } from './utils/common';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown, maxLength: number): value is string {
    return typeof value === 'string'
        && value.trim().length > 0
        && value.trim().length <= maxLength
        && !/[\r\n\0]/.test(value);
}

function isSeat(value: unknown): value is string {
    return isText(value, 20) && /^[A-Za-z0-9-]+$/.test(value);
}

function parseSeats(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const seats: string[] = [];
    for (const seat of value) {
        if (!isSeat(seat)) return undefined;
        seats.push(seat);
    }
    return seats;
}

function parseConfirmation(value: unknown): BookingConfirmationEmail | undefined {
    if (!isRecord(value) || !isRecord(value.customer)) return undefined;

    const bookingRef = value.bookingRef;
    const firstName = value.customer.firstName;
    const surname = value.customer.surname;
    const email = value.customer.email;
    const phone = value.customer.phone;
    const movieTitle = value.movieTitle;
    const date = value.date;
    const time = value.time;
    const screen = value.screen;
    const seats = parseSeats(value.seats);
    const tickets = value.tickets;
    const totalPrice = value.totalPrice;

    if (
        !isText(bookingRef, 10)
        || !/^BBT-\d{6}$/.test(bookingRef)
        || !isText(firstName, 80)
        || !isText(surname, 80)
        || !isText(email, 254)
        || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
        || (phone !== undefined && phone !== '' && !isText(phone, 32))
        || !isText(movieTitle, 160)
        || !isText(date, 64)
        || typeof time !== 'string'
        || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)
        || !isText(screen, 32)
        || !seats
        || typeof tickets !== 'number'
        || !Number.isInteger(tickets)
        || tickets < 1
        || tickets > 10
        || seats.length !== tickets
        || new Set(seats).size !== seats.length
        || typeof totalPrice !== 'number'
        || !Number.isFinite(totalPrice)
        || totalPrice < 0
        || totalPrice > 10000
    ) {
        return undefined;
    }

    return {
        bookingRef,
        customer: {
            firstName,
            surname,
            email,
            ...(typeof phone === 'string' && phone && { phone }),
        },
        movieTitle,
        date,
        time,
        screen,
        seats,
        tickets,
        totalPrice,
    };
}

export const handler = async (
    event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
    const requestId = event.requestContext?.requestId;
    if (!event.body) return json(400, { message: 'A JSON request body is required.' });

    let request: unknown;
    try {
        const body = event.isBase64Encoded
            ? Buffer.from(event.body, 'base64').toString('utf8')
            : event.body;
        request = JSON.parse(body);
    } catch {
        return json(400, { message: 'Request body must contain valid JSON.' });
    }

    const confirmation = parseConfirmation(request);
    if (!confirmation) {
        return json(400, { message: 'Booking confirmation details are invalid.' });
    }

    const source = process.env.BOOKING_EMAIL_FROM;
    if (!source) {
        log('ERROR', 'Booking email sender is not configured', { requestId });
        return json(500, { message: 'Booking confirmation email is not configured.' });
    }

    try {
        await sendBookingConfirmationEmail(confirmation);
        return json(200, {
            message: 'Booking reservation confirmation email sent.',
            bookingRef: confirmation.bookingRef,
        });
    } catch (error: unknown) {
        log('ERROR', 'Failed to create or send booking confirmation email', {
            requestId,
            error: error instanceof Error ? error.name : 'Unknown error',
        });
        return json(502, { message: 'Unable to send booking confirmation email.' });
    }
};
