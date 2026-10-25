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

function createEvent(body: string, isBase64Encoded = false): APIGatewayProxyEventV2 {
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
        isBase64Encoded,
    };
}

describe('booking confirmation email handler', () => {
    beforeEach(() => {
        sesMock.reset();
        process.env.BOOKING_EMAIL_FROM = 'niallmclaughlin1998@gmail.com';
    });

    it('sends an unpaid reservation confirmation and QR reference through SES', async () => {
        sesMock.on(SendEmailCommand).resolves({});

        const result = await handler(createEvent(JSON.stringify(booking)));

        expect(result.statusCode).toBe(200);
        expect(JSON.parse(String(result.body))).toEqual({
            message: 'Booking reservation confirmation email sent.',
            bookingRef: booking.bookingRef,
        });
        const sent = sesMock.calls()[0].args[0].input;
        expect(sent.FromEmailAddress).toBe('niallmclaughlin1998@gmail.com');
        expect(sent.Destination?.ToAddresses).toEqual([booking.customer.email]);
        expect(sent.Content?.Simple?.Subject?.Data).toContain(booking.bookingRef);
        expect(sent.Content?.Simple?.Body?.Text?.Data).toContain(
            'Your seat reservation has been recorded, but payment has not been processed.'
        );
        const html = sent.Content?.Simple?.Body?.Html?.Data ?? '';
        expect(html).toContain('background-color:#0c0d12');
        expect(html).toContain('<meta name="color-scheme" content="dark">');
        expect(html).toContain('<meta name="supported-color-schemes" content="dark">');
        expect(html).toContain(':root { color-scheme: dark; supported-color-schemes: dark; }');
        expect(html).toContain('@media (prefers-color-scheme: dark)');
        expect(html).toContain('background-image:linear-gradient(#0c0d12,#0c0d12)');
        expect(html).toContain('background-image:linear-gradient(#343744,#343744)');
        expect(html).toContain('background-image:linear-gradient(#ffffff,#ffffff)');
        expect(html).toContain('color-scheme:light');
        expect(html).toContain('#ff334b');
        expect(html).toContain('&lt;Movie &amp; More&gt;');
        expect(html).toContain('DATE &amp; SHOWTIME');
        expect(html).toContain('SCREEN');
        expect(html).toContain('SEAT NUMBERS');
        expect(html).toContain('TOTAL');
        expect(html).toContain('GUEST NAME');
        expect(html).toContain('TICKET BREAKDOWN');
        expect(html).toContain('src="cid:booking-reference-qr"');
        expect(html).toContain('REFERENCE ONLY - NOT VALID FOR ENTRY');
        expect(html.indexOf('src="cid:booking-reference-qr"')).toBeGreaterThan(
            html.indexOf(`REF: ${booking.bookingRef}`)
        );
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

    it('accepts a base64 request with one ticket and an optional phone number', async () => {
        sesMock.on(SendEmailCommand).resolves({});
        const singleTicket = {
            ...booking,
            customer: { ...booking.customer, phone: '+441234567890' },
            tickets: 1,
            seats: ['A1'],
        };

        const result = await handler(createEvent(
            Buffer.from(JSON.stringify(singleTicket)).toString('base64'),
            true
        ));

        expect(result.statusCode).toBe(200);
        const sent = sesMock.calls()[0].args[0].input;
        expect(sent.Content?.Simple?.Body?.Text?.Data).toContain('Phone: +441234567890');
        expect(sent.Content?.Simple?.Body?.Html?.Data).toContain('1 Ticket');
    });

    it.each([
        ['non-object body', null],
        ['missing customer object', { ...booking, customer: null }],
        ['invalid booking reference', { ...booking, bookingRef: 'invalid' }],
        ['blank first name', { ...booking, customer: { ...booking.customer, firstName: ' ' } }],
        ['overlong surname', { ...booking, customer: { ...booking.customer, surname: 'x'.repeat(81) } }],
        ['invalid email', { ...booking, customer: { ...booking.customer, email: 'not-an-email' } }],
        ['invalid phone', { ...booking, customer: { ...booking.customer, phone: 'bad\nphone' } }],
        ['overlong movie title', { ...booking, movieTitle: 'x'.repeat(161) }],
        ['invalid date', { ...booking, date: 'bad\nvalue' }],
        ['invalid showtime', { ...booking, time: '25:00' }],
        ['blank screen', { ...booking, screen: '' }],
        ['non-array seats', { ...booking, seats: 'A1,A2' }],
        ['invalid seat characters', { ...booking, seats: ['A/1', 'A2'] }],
        ['fractional ticket count', { ...booking, tickets: 2.5 }],
        ['too many tickets', { ...booking, tickets: 11, seats: Array(11).fill('A1') }],
        ['duplicate seats', { ...booking, seats: ['A1', 'A1'] }],
        ['negative total', { ...booking, totalPrice: -1 }],
        ['excessive total', { ...booking, totalPrice: 10001 }],
    ])('rejects %s without sending email', async (_name, invalidBooking) => {
        const result = await handler(createEvent(JSON.stringify(invalidBooking)));

        expect(result.statusCode).toBe(400);
        expect(sesMock.calls()).toHaveLength(0);
    });

    it('returns a configuration error when the sender address is missing', async () => {
        const sender = process.env.BOOKING_EMAIL_FROM;
        delete process.env.BOOKING_EMAIL_FROM;

        try {
            const result = await handler(createEvent(JSON.stringify(booking)));

            expect(result.statusCode).toBe(500);
            expect(JSON.parse(String(result.body))).toEqual({
                message: 'Booking confirmation email is not configured.',
            });
        } finally {
            process.env.BOOKING_EMAIL_FROM = sender;
        }
    });

    it('handles SES failures that are not Error objects', async () => {
        sesMock.on(SendEmailCommand).callsFake(() => Promise.reject('SES unavailable'));

        const result = await handler(createEvent(JSON.stringify(booking)));

        expect(result.statusCode).toBe(502);
        expect(JSON.parse(String(result.body))).toEqual({
            message: 'Unable to send booking confirmation email.',
        });
    });
});
