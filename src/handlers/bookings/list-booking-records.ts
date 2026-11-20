import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { GuestBookingError, listGuestBookedSeats } from '../../services/bookings/guest-booking-service';
import { authenticateOptional, InvalidAuthorizationError, json, log, type OptionalJwtEvent } from '../../main/lambda/handlers/utils/common';
import { ShowtimeIdError } from '../../main/lambda/handlers/utils/showtime-ids';
import { listAccountBookings } from '../../services/bookings/list-account-bookings';
import { getShowtimeCutoff, linkGuestBookings } from '../../services/bookings/link-guest-bookings';
import { canAccessBooking, getBookingByReference } from './get-booking-record';

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
    try {
        const identity = await authenticateOptional(event.headers ?? {});
        const { showtimeId, date, status, bookingRef, email } = event.queryStringParameters ?? {};
        const modes = Number(Boolean(showtimeId)) + Number(Boolean(status)) + Number(Boolean(bookingRef || email));
        if (modes !== 1) return json(400, { message: 'Provide showtimeId, status, or bookingRef and email.' });
        if (status) {
            if (status !== 'upcoming' && status !== 'past') return json(400, { message: 'status must be upcoming or past.' });
            if (!identity) return json(401, { message: 'A valid Cognito user is required.' });
            const linked = identity.verifiedEmail
                && await isGuestLinkingAllowed()
                ? await linkGuestBookings(identity.userId, identity.verifiedEmail)
                : { bookings: [], notificationSent: true };
            const cutoff = getShowtimeCutoff(new Date());
            const bookings = await listAccountBookings(identity.userId, linked.bookings);
            const body: AccountBookingHistoryResponse = {
                bookings: bookings.filter((booking) => {
                    const upcoming = booking.date > cutoff.date
                        || (booking.date === cutoff.date && booking.time >= cutoff.time);
                    return status === 'upcoming' ? upcoming : !upcoming;
                }),
                newlyLinkedBookings: linked.bookings.map((booking) => booking.bookingRef),
                ...(linked.notificationSent ? {} : { linkNotificationSent: false }),
            };
            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
                body: JSON.stringify(body),
            };
        }
        if (bookingRef || email) {
            if (!bookingRef?.trim() || !email?.trim()) return json(400, { message: 'bookingRef and email are required.' });
            const booking = await getBookingByReference(bookingRef.trim());
            if (!booking || !canAccessBooking(booking, identity, bookingRef.trim(), email)) {
                return json(404, { message: 'Booking not found.' });
            }
            const { PK, SK, conversionTokenHash, ...publicBooking } = booking;
            return json(200, { booking: publicBooking });
        }
        const result = await listGuestBookedSeats(
            showtimeId, date, identity?.userId
        );
        return json(200, result);
    } catch (error: unknown) {
        if (error instanceof InvalidAuthorizationError) return json(401, { message: error.message });
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
            message: event.queryStringParameters?.status
                ? 'Unable to list account bookings.'
                : 'Unable to list booked seats.',
        });
    }
};
