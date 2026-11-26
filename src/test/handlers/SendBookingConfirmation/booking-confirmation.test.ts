import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';

const sesMock = mockClient(SESv2Client);
const ddbMock = mockClient(DynamoDBDocumentClient);
process.env.BOOKINGS_TABLE_NAME = 'test-bookings';
let handler: (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;

beforeAll(async () => {
    ({ handler } =
        await import('../../../handlers/bookings/send-booking-confirmation'));
});

const booking = {
    PK: 'BOOKING#bk_1',
    SK: 'METADATA',
    recordType: 'BOOKING',
    bookingId: 'bk_1',
    bookingRef: 'BBT-123456',
    customerName: 'Niall McLaughlin',
    customerEmail: 'customer@example.com',
    movieTitle: '<Movie & More>',
    date: 'Tue 20 Oct 2026',
    time: '19:00',
    screen: '2',
    seats: ['A1', 'A2'],
    tickets: 2,
    totalAmount: 15.2,
};

function createEvent(body: string, isBase64Encoded = false): APIGatewayProxyEventV2 {
    return {
        version: '2.0',
        routeKey: 'POST /booking/confirmation',
        rawPath: '/booking/confirmation',
        rawQueryString: '',
        headers: {},
        pathParameters: { bookingId: 'bk_1' },
        queryStringParameters: { bookingRef: booking.bookingRef, email: booking.customerEmail },
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
        ddbMock.reset();
        ddbMock.on(GetCommand).resolves({ Item: booking });
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
        expect(sent.Destination?.ToAddresses).toEqual([booking.customerEmail]);
        expect(sent.Content?.Simple?.Subject?.Data).toContain(booking.bookingRef);
        expect(sent.Content?.Simple?.Body?.Text?.Data).toContain(
            'Your seat reservation has been recorded, but payment has not been processed.',
        );

        const html = sent.Content?.Simple?.Body?.Html?.Data ?? '';
        expect(html).toContain('<meta name="color-scheme" content="dark">');
        expect(html).toContain('<meta name="supported-color-schemes" content="dark">');
        expect(html).toContain('@media (prefers-color-scheme: dark)');
        expect(html).not.toMatch(/\sstyle=/);
        expect(html).toContain('#ff334b');
        expect(html).toContain('&lt;Movie &amp; More&gt;');
        expect(html).toContain('SHOWTIME');
        expect(html).toContain('SCREEN');
        expect(html).toContain('Seats');
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
            Buffer.from('89504e470d0a1a0a', 'hex'),
        );
    });

    it('uses stored details rather than client-supplied confirmation data', async () => {
        sesMock.on(SendEmailCommand).resolves({});
        const result = await handler(createEvent(JSON.stringify({
            customerEmail: 'attacker@example.com', movieTitle: 'Forged', totalAmount: 0,
        })));
        expect(result.statusCode).toBe(200);
        const sent = sesMock.commandCalls(SendEmailCommand)[0].args[0].input;
        expect(sent.Destination?.ToAddresses).toEqual([booking.customerEmail]);
        expect(sent.Content?.Simple?.Body?.Text?.Data).toContain(booking.movieTitle);
        expect(sent.Content?.Simple?.Body?.Text?.Data).not.toContain('Forged');
    });

    it('does not send a confirmation to an unauthorized requester', async () => {
        const request = createEvent('');
        request.queryStringParameters = { bookingRef: booking.bookingRef, email: 'attacker@example.com' };
        expect((await handler(request)).statusCode).toBe(404);
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
        ['invalid booking reference', { ...booking, bookingRef: 'invalid' }],
        ['blank customer name', { ...booking, customerName: ' ' }],
        ['overlong movie title', { ...booking, movieTitle: 'x'.repeat(161) }],
        ['invalid date', { ...booking, date: 'bad\nvalue' }],
        ['invalid showtime', { ...booking, time: '25:00' }],
        ['blank screen', { ...booking, screen: '' }],
        ['non-array seats', { ...booking, seats: 'A1,A2' }],
        ['invalid seat characters', { ...booking, seats: ['A/1', 'A2'] }],
        ['too many tickets', { ...booking, seats: Array.from({ length: 31 }, (_, index) => `A${index}`) }],
        ['duplicate seats', { ...booking, seats: ['A1', 'A1'] }],
        ['negative total', { ...booking, totalAmount: -1 }],
        ['excessive total', { ...booking, totalAmount: 10001 }],
    ])('rejects invalid stored %s without sending email', async (_name, invalidBooking) => {
        ddbMock.on(GetCommand).resolves({ Item: invalidBooking });
        const request = createEvent('');
        request.queryStringParameters = { bookingRef: invalidBooking.bookingRef, email: booking.customerEmail };
        const result = await handler(request);

        expect(result.statusCode).toBe(502);
        expect(sesMock.calls()).toHaveLength(0);
    });

    it('returns a configuration error when the sender address is missing', async () => {
        const sender = process.env.BOOKING_EMAIL_FROM;
        delete process.env.BOOKING_EMAIL_FROM;

        try {
            const result = await handler(createEvent(JSON.stringify(booking)));

            expect(result.statusCode).toBe(502);
            expect(JSON.parse(String(result.body))).toEqual({
                message: 'Unable to send booking confirmation email.',
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
