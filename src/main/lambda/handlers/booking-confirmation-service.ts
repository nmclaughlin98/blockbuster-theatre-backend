import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import QRCode = require('qrcode');
import {
    formatBookingConfirmationEmailBody,
    formatBookingConfirmationEmailHtml,
    type BookingConfirmationEmail,
} from './utils/booking-confirmation-email';

const sesClient = new SESv2Client({});

export async function sendBookingConfirmationEmail(
    confirmation: BookingConfirmationEmail
): Promise<void> {
    const source = process.env.BOOKING_EMAIL_FROM;
    if (!source) throw new Error('BOOKING_EMAIL_FROM is not configured.');

    const qrCode = await QRCode.toBuffer(confirmation.bookingRef, {
        errorCorrectionLevel: 'M',
        margin: 4,
        width: 240,
        color: {
            dark: '#0c0d12',
            light: '#ffffff',
        },
    });
    await sesClient.send(new SendEmailCommand({
        FromEmailAddress: source,
        Destination: { ToAddresses: [confirmation.customer.email] },
        Content: {
            Simple: {
                Subject: { Data: `Booking confirmation - ${confirmation.bookingRef}` },
                Body: {
                    Text: { Data: formatBookingConfirmationEmailBody(confirmation) },
                    Html: {
                        Data: formatBookingConfirmationEmailHtml(confirmation),
                        Charset: 'UTF-8',
                    },
                },
                Attachments: [{
                    RawContent: qrCode,
                    ContentType: 'image/png',
                    ContentDisposition: 'INLINE',
                    ContentId: 'booking-reference-qr',
                    ContentTransferEncoding: 'BASE64',
                    FileName: 'booking-reference.png',
                }],
            },
        },
    }));
}
