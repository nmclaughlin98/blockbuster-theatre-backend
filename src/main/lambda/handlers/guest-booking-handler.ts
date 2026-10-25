import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { createGuestBooking, GuestBookingError } from './guest-booking-service';
import { json, log } from './utils/common';
import { ShowtimeIdError } from './utils/showtime-ids';

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

    try {
        return json(201, await createGuestBooking(request));
    } catch (error: unknown) {
        if (error instanceof ShowtimeIdError) {
            return json(error.statusCode, { message: error.message });
        }
        if (error instanceof GuestBookingError) {
            if (error.statusCode >= 500) {
                log('ERROR', 'Failed to create unpaid guest booking', {
                    requestId,
                    statusCode: error.statusCode,
                });
            }
            return json(error.statusCode, { message: error.message });
        }
        log('ERROR', 'Failed to create unpaid guest booking', {
            requestId,
            errorName: error instanceof Error ? error.name : 'UnknownError',
        });
        return json(500, { message: 'Unable to create guest booking.' });
    }
};
