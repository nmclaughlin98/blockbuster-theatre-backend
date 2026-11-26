import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { createGuestBooking, GuestBookingError } from './guest-booking-service';
import { json, log, type OptionalJwtEvent } from '../utils/common';
import { ShowtimeIdError } from '../utils/showtime-ids';

const ACCOUNT_BOOKING_ROUTE_KEY = 'POST /api/v1/bookings/account';

export const handler = async (event: OptionalJwtEvent): Promise<APIGatewayProxyResultV2> => {
    const requestId = event.requestContext?.requestId;
    const isAccountBooking = event.routeKey === ACCOUNT_BOOKING_ROUTE_KEY;
    const userId = event.requestContext.authorizer?.jwt?.claims?.sub;

    if (isAccountBooking && (typeof userId !== 'string' || !userId.trim())) {
        return json(401, { message: 'A valid Cognito user is required.' });
    }

    log('INFO', `${isAccountBooking ? 'Account' : 'Guest'} booking request received.`, { requestId });

    if (!event.body) return json(400, { message: 'A JSON request body is required.' });

    let request: unknown;

    try {
        const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
        request = JSON.parse(body);
    } catch {
        return json(400, { message: 'Request body must contain valid JSON.' });
    }

    try {
        const booking = await createGuestBooking(
            request,
            isAccountBooking && typeof userId === 'string' ? userId : undefined,
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
