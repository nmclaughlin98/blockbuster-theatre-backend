import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from '../../main/lambda/handlers/Shared/dynamodb-client';
import { authenticateOptional, InvalidAuthorizationError, json, log, type OptionalJwtEvent } from '../../main/lambda/handlers/utils/common';

const client = DynamoDBDocumentClient.from(createDynamoDBClient());

export async function getBooking(bookingId: string): Promise<Record<string, unknown> | undefined> {
    const tableName = process.env.BOOKINGS_TABLE_NAME;
    if (!tableName) throw new Error('BOOKINGS_TABLE_NAME is not configured.');
    const result = await client.send(new GetCommand({
        TableName: tableName,
        Key: { PK: `BOOKING#${bookingId}`, SK: 'METADATA' },
        ConsistentRead: true,
    }));
    return result.Item?.recordType === 'BOOKING' && result.Item.bookingId === bookingId
        ? result.Item : undefined;
}

export async function getBookingByReference(reference: string): Promise<Record<string, unknown> | undefined> {
    const tableName = process.env.BOOKINGS_TABLE_NAME;
    if (!tableName) throw new Error('BOOKINGS_TABLE_NAME is not configured.');
    const result = await client.send(new GetCommand({
        TableName: tableName,
        Key: { PK: `REFERENCE#${reference}`, SK: 'METADATA' },
        ConsistentRead: true,
    }));
    if (result.Item?.recordType !== 'REFERENCE' || typeof result.Item.bookingId !== 'string') return undefined;
    return getBooking(result.Item.bookingId);
}

export function canAccessBooking(
    booking: Record<string, unknown>,
    identity: { userId: string } | undefined,
    reference: string | undefined,
    email: string | undefined
): boolean {
    if (identity && booking.userId === identity.userId) return true;
    return (booking.userId === undefined || booking.userId === null)
        && typeof reference === 'string' && reference === booking.bookingRef
        && typeof email === 'string' && typeof booking.customerEmail === 'string'
        && email.trim().toLowerCase() === booking.customerEmail;
}

export async function authorizeBooking(
    event: OptionalJwtEvent
): Promise<Record<string, unknown> | undefined> {
    const identity = await authenticateOptional(event.headers ?? {});
    const bookingId = event.pathParameters?.bookingId;
    if (!bookingId?.trim()) return undefined;
    const booking = await getBooking(bookingId);
    return booking && canAccessBooking(
        booking, identity, event.queryStringParameters?.bookingRef, event.queryStringParameters?.email
    ) ? booking : undefined;
}

export async function handler(event: OptionalJwtEvent): Promise<APIGatewayProxyResultV2> {
    try {
        const booking = await authorizeBooking(event);
        if (!booking) return json(404, { message: 'Booking not found.' });
        const { PK, SK, conversionTokenHash, ...publicBooking } = booking;
        return json(200, { booking: publicBooking });
    } catch (error: unknown) {
        if (error instanceof InvalidAuthorizationError) return json(401, { message: error.message });
        log('ERROR', 'Unable to retrieve booking', {
            requestId: event.requestContext.requestId,
            errorName: error instanceof Error ? error.name : 'UnknownError',
        });
        return json(500, { message: 'Unable to retrieve booking.' });
    }
}
