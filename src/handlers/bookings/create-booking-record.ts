import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { createGuestBooking, GuestBookingError } from '../../services/bookings/guest-booking-service';
import { authenticateOptional, InvalidAuthorizationError, json, log, type OptionalJwtEvent } from '../../main/lambda/handlers/utils/common';
import { ShowtimeIdError } from '../../main/lambda/handlers/utils/showtime-ids';

export const handler = async (
    event: OptionalJwtEvent
): Promise<APIGatewayProxyResultV2> => {
    const requestId = event.requestContext?.requestId;
    let userId: string | undefined;
    try {
        userId = (await authenticateOptional(event.headers ?? {}))?.userId;
    } catch (error: unknown) {
        if (error instanceof InvalidAuthorizationError) return json(401, { message: error.message });
        log('ERROR', 'Booking authorization failed', { requestId, errorName: error instanceof Error ? error.name : 'UnknownError' });
        return json(500, { message: 'Unable to authorize request.' });
    }
    const isAccountBooking = Boolean(userId);
    log('INFO', `${isAccountBooking ? 'Account' : 'Guest'} booking request received.`, { requestId });
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
        const booking = await createGuestBooking(
            request,
            userId
        );
        log('INFO', `${isAccountBooking ? 'Account' : 'Guest'} booking created.`, {
            requestId,
            bookingId: booking.bookingId,
        });
        return json(201, booking);
    } catch (error: unknown) {
        if (error instanceof ShowtimeIdError) {
            return json(error.statusCode, { message: error.message });
        }
        if (error instanceof GuestBookingError) {
            if (error.statusCode >= 500) {
                log('ERROR', `Failed to create ${isAccountBooking ? 'account' : 'guest'} booking`, {
                    requestId,
                    statusCode: error.statusCode,
                });
            }
            return json(error.statusCode, { message: error.message });
        }
        log('ERROR', `Failed to create ${isAccountBooking ? 'account' : 'guest'} booking`, {
            requestId,
            errorName: error instanceof Error ? error.name : 'UnknownError',
        });
        return json(500, {
            message: `Unable to create ${isAccountBooking ? 'account' : 'guest'} booking.`,
        });
    }
};
