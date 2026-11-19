import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { GuestBookingError, listGuestBookedSeats } from '../GuestBooking/guest-booking-service';
import { json, log, type OptionalJwtEvent } from '../utils/common';
import { ShowtimeIdError } from '../utils/showtime-ids';
import { listAccountBookings } from './list-account-bookings';
import { linkGuestBookings } from './link-guest-bookings';

const ACCOUNT_BOOKED_SEATS_ROUTE_KEY = 'GET /api/v1/bookings/account';
const ACCOUNT_HISTORY_ROUTE_KEY = 'GET /api/v1/bookings/account/history';
const ssmClient = new SSMClient({ region: process.env.AWS_REGION ?? 'eu-west-2' });

async function isGuestLinkingAllowed(): Promise<boolean> {
    const parameterName = process.env.ALLOW_LINK_BOOKINGS_PARAMETER_NAME;
    if (!parameterName) {
        log('WARN', 'Guest booking linking parameter is not configured; linking is disabled.');
        return false;
    }

    try {
        const result = await ssmClient.send(new GetParameterCommand({ Name: parameterName }));
        const value = result.Parameter?.Value?.trim().toLowerCase();
        if (value !== 'true' && value !== 'false') {
            throw new Error('Guest booking linking parameter must be true or false.');
        }
        return value === 'true';
    } catch (error: unknown) {
        if (error instanceof Error && error.name === 'ParameterNotFound') {
            log('WARN', 'Guest booking linking parameter was not found; linking is disabled.', {
                parameterName,
            });
            return false;
        }
        throw error;
    }
}

export interface AccountBookingHistoryResponse {
    bookings: Awaited<ReturnType<typeof listAccountBookings>>;
    newlyLinkedBookings: string[];
    linkNotificationSent?: false;
}

export const handler = async (
    event: OptionalJwtEvent
): Promise<APIGatewayProxyResultV2> => {
    const requestId = event.requestContext?.requestId;
    const isAccountRequest = event.routeKey === ACCOUNT_BOOKED_SEATS_ROUTE_KEY
        || event.routeKey === ACCOUNT_HISTORY_ROUTE_KEY;
    const userId = event.requestContext.authorizer?.jwt?.claims?.sub;
    if (isAccountRequest && (typeof userId !== 'string' || !userId.trim())) {
        return json(401, { message: 'A valid Cognito user is required.' });
    }
    try {
        if (event.routeKey === ACCOUNT_HISTORY_ROUTE_KEY && typeof userId === 'string') {
            const claims = event.requestContext.authorizer?.jwt?.claims;
            const email = claims?.email;
            const verified = claims?.email_verified;
            const linked = claims?.token_use === 'id'
                && typeof email === 'string' && email.trim()
                && (verified === true || verified === 'true')
                && await isGuestLinkingAllowed()
                ? await linkGuestBookings(userId, email.trim().toLowerCase())
                : { bookings: [], notificationSent: true };
            const body: AccountBookingHistoryResponse = {
                bookings: await listAccountBookings(userId, linked.bookings),
                newlyLinkedBookings: linked.bookings.map((booking) => booking.bookingRef),
                ...(linked.notificationSent ? {} : { linkNotificationSent: false }),
            };
            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
                body: JSON.stringify(body),
            };
        }
        const result = await listGuestBookedSeats(
            event.queryStringParameters?.showtimeId,
            event.queryStringParameters?.date,
            isAccountRequest && typeof userId === 'string' ? userId : undefined
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
        return json(500, {
            message: event.routeKey === ACCOUNT_HISTORY_ROUTE_KEY
                ? 'Unable to list account bookings.'
                : 'Unable to list booked seats.',
        });
    }
};
