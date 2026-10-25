import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { BookingServiceError, listBookedSeats, parseShowingQuery } from './booking-service';
import { json, log } from './utils/common';

export const handler = async (
    event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
    const requestId = event.requestContext?.requestId;

    try {
        const selection = parseShowingQuery(event.queryStringParameters ?? {});
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
