import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GuestBookingError, listGuestBookedSeats } from './guest-booking-service';
import { json, log } from './utils/common';
import { ShowtimeIdError } from './utils/showtime-ids';

const ACCOUNT_BOOKED_SEATS_ROUTE_KEY = 'GET /api/v1/bookings/account';

export const handler = async (
    event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
    const requestId = event.requestContext?.requestId;
    const isAccountRequest = event.routeKey === ACCOUNT_BOOKED_SEATS_ROUTE_KEY;
    const userId = event.requestContext.authorizer?.jwt?.claims?.sub;
    if (isAccountRequest && (typeof userId !== 'string' || !userId.trim())) {
        return json(401, { message: 'A valid Cognito user is required.' });
    }
    try {
        const result = await listGuestBookedSeats(
            event.queryStringParameters?.showtimeId,
            event.queryStringParameters?.date,
            isAccountRequest ? userId : undefined
        );
        return json(200, result);
    } catch (error: unknown) {
        if (error instanceof ShowtimeIdError) {
            return json(error.statusCode, { message: error.message });
        }
        if (error instanceof GuestBookingError) {
            if (error.statusCode >= 500) {
                log('ERROR', 'Failed to list booked seats', {
                    requestId,
                    statusCode: error.statusCode,
                });
            }
            return json(error.statusCode, { message: error.message });
        }
        log('ERROR', 'Failed to list booked seats', {
            requestId,
            errorName: error instanceof Error ? error.name : 'UnknownError',
        });
        return json(500, { message: 'Unable to list booked seats.' });
    }
};
