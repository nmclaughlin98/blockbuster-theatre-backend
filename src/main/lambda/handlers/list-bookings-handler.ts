import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { BookingServiceError, listBookedSeats, parseShowingQuery } from './booking-service';
import { GuestBookingError, listGuestBookedSeats } from './guest-booking-service';
import { json, log } from './utils/common';

export const handler = async (
    event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
    const requestId = event.requestContext?.requestId;
    const query = event.queryStringParameters ?? {};
    if (query.showtimeId !== undefined) {
        try {
            return json(
                200,
                await listGuestBookedSeats(query.showtimeId, query.date)
            );
        } catch (error: unknown) {
            if (error instanceof GuestBookingError) {
                if (error.statusCode >= 500) {
                    log('ERROR', 'Failed to list guest booked seats', {
                        requestId,
                        statusCode: error.statusCode,
                    });
                }
                return json(error.statusCode, { message: error.message });
            }
            log('ERROR', 'Failed to list guest booked seats', {
                requestId,
                errorName: error instanceof Error ? error.name : 'UnknownError',
            });
            return json(500, { message: 'Unable to list booked seats.' });
        }
    }

    try {
        const selection = parseShowingQuery(query);
        return json(200, {
            movieId: selection.movieId,
            date: selection.date,
            showtime: selection.showtime,
            bookedSeats: await listBookedSeats(selection),
        });
    } catch (error: unknown) {
        if (error instanceof BookingServiceError) {
            if (error.statusCode >= 500) {
                log('ERROR', 'Failed to list bookings', { requestId, error: error.message });
            }
            return json(error.statusCode, { message: error.message });
        }
        log('ERROR', 'Failed to list bookings', {
            requestId,
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        return json(500, { message: 'Unable to list bookings.' });
    }
};
