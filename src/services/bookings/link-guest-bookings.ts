import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand, type QueryCommandOutput } from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from '../../main/lambda/handlers/Shared/dynamodb-client';
import { log } from '../../main/lambda/handlers/utils/common';

const docClient = DynamoDBDocumentClient.from(createDynamoDBClient());
const sesClient = new SESv2Client({});

export interface LinkedBooking {
    bookingId: string;
    bookingRef: string;
    movieId: string;
    movieTitle: string;
    date: string;
    time: string;
    [key: string]: unknown;
}

export interface GuestLinkResult {
    bookings: LinkedBooking[];
    notificationSent: boolean;
}

function isLinkedBooking(item: Record<string, unknown>): item is LinkedBooking {
    const date = typeof item.date === 'string' ? new Date(`${item.date}T00:00:00Z`) : new Date(NaN);
    return typeof item.bookingId === 'string' && item.bookingId.length > 0
        && item.PK === `BOOKING#${item.bookingId}` && item.SK === 'METADATA'
        && typeof item.bookingRef === 'string' && item.bookingRef.length > 0
        && typeof item.movieId === 'string' && item.movieId.length > 0
        && typeof item.movieTitle === 'string' && item.movieTitle.length > 0
        && typeof item.bookedAt === 'string' && item.bookedAt.length > 0
        && typeof item.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.date)
        && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === item.date
        && typeof item.time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item.time)
        && typeof item.screen === 'string' && item.screen.length > 0
        && Array.isArray(item.seats) && item.seats.length > 0
        && item.seats.every((seat: unknown) => typeof seat === 'string' && seat.length > 0);
}

export function getShowtimeCutoff(now: Date): { date: string; time: string } {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    const minute = Number(values.minute) + (
        Number(values.second) > 0 || now.getMilliseconds() > 0 ? 1 : 0
    );
    const cutoff = new Date(Date.UTC(
        Number(values.year),
        Number(values.month) - 1,
        Number(values.day),
        Number(values.hour),
        minute
    ));
    return {
        date: cutoff.toISOString().slice(0, 10),
        time: cutoff.toISOString().slice(11, 16),
    };
}

function isUpcomingBooking(item: LinkedBooking, cutoff: { date: string; time: string }): boolean {
    return item.date > cutoff.date || (item.date === cutoff.date && item.time >= cutoff.time);
}

function showtimeGroupKey(item: LinkedBooking): string {
    return JSON.stringify([item.movieId, item.date, item.time, item.screen]);
}

export async function linkGuestBookings(userId: string, email: string): Promise<GuestLinkResult> {
    const tableName = process.env.BOOKINGS_TABLE_NAME;
    if (!tableName) throw new Error('Booking table is not configured.');

    const cutoff = getShowtimeCutoff(new Date());
    const candidates: LinkedBooking[] = [];
    for (const today of [false, true]) {
            let exclusiveStartKey: Record<string, unknown> | undefined;
            do {
                const page: QueryCommandOutput = await docClient.send(new QueryCommand({
                    TableName: tableName,
                    IndexName: 'CustomerEmailBookings',
                    KeyConditionExpression: `customerEmail = :email AND screeningKey ${today ? 'BETWEEN :start AND :end' : '> :end'}`,
                    FilterExpression: `recordType = :booking AND (attribute_not_exists(userId) OR userId = :null)${today ? ' AND #time >= :cutoffTime' : ''}`,
                    ...(today && { ExpressionAttributeNames: { '#time': 'time' } }),
                    ExpressionAttributeValues: {
                        ':email': email,
                        ':booking': 'BOOKING',
                        ':null': null,
                        ':end': `${cutoff.date}T99`,
                        ...(today && { ':start': `${cutoff.date}T00` }),
                        ...(today && { ':cutoffTime': cutoff.time }),
                    },
                    ExclusiveStartKey: exclusiveStartKey,
                }));
                for (const item of page.Items ?? []) {
                    if (!isLinkedBooking(item)) {
                        throw new Error('Guest booking contains invalid linking details.');
                    }
                    if (!isUpcomingBooking(item, cutoff)) continue;
                    candidates.push(item);
                }
                exclusiveStartKey = page.LastEvaluatedKey;
            } while (exclusiveStartKey);
    }

    const linked: LinkedBooking[] = [];
    let notificationSent = true;
    try {
        for (const item of candidates) {
            try {
                const result = await docClient.send(new UpdateCommand({
                    TableName: tableName,
                    Key: { PK: item.PK, SK: item.SK },
                    UpdateExpression: 'SET userId = :userId, claimedAt = :claimedAt, claimMethod = :method REMOVE conversionTokenHash, guestAccessToken',
                    ConditionExpression: 'recordType = :booking AND bookingId = :bookingId AND customerEmail = :email AND movieId = :movieId AND #date = :date AND #time = :time AND screen = :screen AND (attribute_not_exists(userId) OR userId = :null)',
                    ExpressionAttributeNames: { '#date': 'date', '#time': 'time' },
                    ExpressionAttributeValues: {
                        ':userId': userId,
                        ':claimedAt': new Date().toISOString(),
                        ':method': 'AUTO_EMAIL_MATCH',
                        ':booking': 'BOOKING',
                        ':bookingId': item.bookingId,
                        ':email': email,
                        ':movieId': item.movieId,
                        ':date': item.date,
                        ':time': item.time,
                        ':screen': item.screen,
                        ':null': null,
                    },
                    ReturnValues: 'ALL_NEW',
                }));
                if (
                    !result.Attributes
                    || !isLinkedBooking(result.Attributes)
                    || !isUpcomingBooking(result.Attributes, cutoff)
                    || showtimeGroupKey(result.Attributes) !== showtimeGroupKey(item)
                ) {
                    throw new Error('Updated guest booking contains invalid linking details.');
                }
                linked.push(result.Attributes);
            } catch (error: unknown) {
                if (!(error instanceof Error) || error.name !== 'ConditionalCheckFailedException') throw error;
            }
        }
    } finally {
        if (linked.length) {
            try {
                const source = process.env.BOOKING_EMAIL_FROM;
                if (!source) throw new Error('BOOKING_EMAIL_FROM is not configured.');
                const groupedBookings = new Map<string, LinkedBooking[]>();
                for (const booking of linked) {
                    const groupKey = showtimeGroupKey(booking);
                    groupedBookings.set(groupKey, [
                        ...(groupedBookings.get(groupKey) ?? []),
                        booking,
                    ]);
                }
                await sesClient.send(new SendEmailCommand({
                    FromEmailAddress: source,
                    Destination: { ToAddresses: [email] },
                    Content: { Simple: {
                        Subject: { Data: "We've linked your guest booking(s) to your Blockbuster Theatre account" },
                        Body: { Text: { Data: [
                            'Because you checked out using your account email address, these bookings have been automatically added to your account:',
                            '',
                            ...[...groupedBookings.values()].flatMap((bookings) => [
                                `${bookings[0].movieTitle} - ${bookings[0].date} ${bookings[0].time}`,
                                ...bookings.map((booking) => booking.bookingRef),
                                '',
                            ]),
                            'Your previous guest conversion link has been disabled for security.',
                        ].join('\n') } },
                    } },
                }));
            } catch (error: unknown) {
                notificationSent = false;
                log('ERROR', 'Guest bookings linked but notification email failed', {
                    errorName: error instanceof Error ? error.name : 'UnknownError',
                    bookingCount: linked.length,
                });
            }
        }
    }
    return { bookings: linked, notificationSent };
}
