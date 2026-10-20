import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { mockClient } from 'aws-sdk-client-mock';

const sesMock = mockClient(SESv2Client);
const { handler } = require('../../main/lambda/handlers/send-booking-confirmation-handler') as {
    handler: (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;
};

const booking = {
    bookingRef: 'BBT-123456',
    customer: {
        firstName: 'Niall',
        surname: 'McLaughlin',
        email: 'niallmclaughlin1998@gmail.com',
        phone: '',
    },
    movieTitle: '<Movie & More>',
    date: 'Tue 20 Oct 2026',
    time: '19:00',
    screen: '2',
    seats: ['A1', 'A2'],
    tickets: 2,
    totalPrice: 15.2,
};

function createEvent(body: string): APIGatewayProxyEventV2 {
    return {
        version: '2.0',
        routeKey: 'POST /booking/confirmation',
        rawPath: '/booking/confirmation',
        rawQueryString: '',
        headers: {},
        requestContext: {
            accountId: 'test-account',
            apiId: 'test-api',
            domainName: 'example.com',
            domainPrefix: 'test',
            http: {
                method: 'POST',
                path: '/booking/confirmation',
                protocol: 'HTTP/1.1',
                sourceIp: '127.0.0.1',
                userAgent: 'jest',
            },
            requestId: 'booking-confirmation-test',
            routeKey: 'POST /booking/confirmation',
            stage: '$default',
            time: '20/Oct/2026:19:00:00 +0000',
            timeEpoch: 1792522800000,
        },
        body,
        isBase64Encoded: false,
    };
}

describe('booking confirmation email handler', () => {
    beforeEach(() => {
        sesMock.reset();
        process.env.BOOKING_EMAIL_FROM = 'niallmclaughlin1998@gmail.com';
    });

    it('sends a clearly labelled demo confirmation through SES', async () => {
        sesMock.on(SendEmailCommand).resolves({});

        const result = await handler(createEvent(JSON.stringify(booking)));

        expect(result.statusCode).toBe(200);
        expect(JSON.parse(String(result.body))).toEqual({
            message: 'Demo booking confirmation email sent.',
            bookingRef: booking.bookingRef,
        });
        const sent = sesMock.calls()[0].args[0].input;
        expect(sent.FromEmailAddress).toBe('niallmclaughlin1998@gmail.com');
        expect(sent.Destination?.ToAddresses).toEqual([booking.customer.email]);
        expect(sent.Content?.Simple?.Subject?.Data).toContain(booking.bookingRef);
        expect(sent.Content?.Simple?.Body?.Text?.Data).toContain(
            'No payment was taken and this email is not a valid cinema ticket.'
        );
        const html = sent.Content?.Simple?.Body?.Html?.Data ?? '';
        expect(html).toContain('background-color:#0c0d12');
        expect(html).toContain('#ff334b');
        expect(html).toContain('&lt;Movie &amp; More&gt;');
        expect(html).toContain('src="cid:booking-reference-qr"');
        const qrCode = sent.Content?.Simple?.Attachments?.[0];
        expect(qrCode).toMatchObject({
            ContentType: 'image/png',
            ContentDisposition: 'INLINE',
            ContentId: 'booking-reference-qr',
            FileName: 'booking-reference.png',
        });
        expect(Buffer.from(qrCode?.RawContent ?? []).subarray(0, 8)).toEqual(
            Buffer.from('89504e470d0a1a0a', 'hex')
        );
    });

    it('rejects invalid booking details without calling SES', async () => {
        const invalidBooking = { ...booking, seats: ['A1'] };

        const result = await handler(createEvent(JSON.stringify(invalidBooking)));

        expect(result.statusCode).toBe(400);
        expect(sesMock.calls()).toHaveLength(0);
    });

    it('returns a client error for invalid JSON', async () => {
        const result = await handler(createEvent('{'));

        expect(result.statusCode).toBe(400);
        expect(sesMock.calls()).toHaveLength(0);
    });

    it('reports an SES send failure', async () => {
        sesMock.on(SendEmailCommand).rejects(new Error('SES unavailable'));

        const result = await handler(createEvent(JSON.stringify(booking)));

        expect(result.statusCode).toBe(502);
        expect(JSON.parse(String(result.body))).toEqual({
            message: 'Unable to send booking confirmation email.',
        });
    });
});
