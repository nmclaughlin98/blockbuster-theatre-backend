import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import {
    AdminGetUserCommand,
    CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { GuestBookingError, listGuestBookedSeats } from '../../services/bookings/guest-booking-service';
import { authenticateOptional, InvalidAuthorizationError, json, log, type OptionalJwtEvent } from '../../main/lambda/handlers/utils/common';
import { ShowtimeIdError } from '../../main/lambda/handlers/utils/showtime-ids';
import { listAccountBookings } from '../../services/bookings/list-account-bookings';
import { getShowtimeCutoff, linkGuestBookings } from '../../services/bookings/link-guest-bookings';
import { canAccessBooking, getBookingByReference } from './get-booking-record';

const ssmClient = new SSMClient({ region: process.env.AWS_REGION ?? 'eu-west-2' });
const cognitoClient = new CognitoIdentityProviderClient({});

async function getVerifiedEmail(userId: string): Promise<string | undefined> {
    const userPoolId = process.env.USER_POOL_ID;

    if (!userPoolId) throw new Error('USER_POOL_ID is not configured.');

    const user = await cognitoClient.send(
        new AdminGetUserCommand({
            UserPoolId: userPoolId,
            Username: userId,
        }),
    );

    const email = user.UserAttributes?.find((attribute) => attribute.Name === 'email')?.Value;
    const verified = user.UserAttributes?.find((attribute) => attribute.Name === 'email_verified')?.Value;

    if (!email?.trim()) {
        log('WARN', 'Cognito user has no email; guest booking linking is skipped.');

        return undefined;
    }

    return verified === 'true' ? email.trim().toLowerCase() : undefined;
}

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

export const handler = async (event: OptionalJwtEvent): Promise<APIGatewayProxyResultV2> => {
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
        const result = await listGuestBookedSeats(
            event.queryStringParameters?.showtimeId,
            event.queryStringParameters?.date,
            isAccountRequest && typeof userId === 'string' ? userId : undefined
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
            message:
                event.queryStringParameters?.status
                    ? 'Unable to list account bookings.'
                    : 'Unable to list booked seats.',
        });
    }
};
