import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import QRCode = require('qrcode');
import {
    formatBookingConfirmationEmailBody,
    formatBookingConfirmationEmailHtml,
    type BookingConfirmationEmail,
} from './utils/booking-confirmation-email';
import { generateTicketPdf, type TicketPdfInput } from './utils/ticket-pdf-generator';

const sesClient = new SESv2Client({});

export interface BookingConfirmationWithTicket extends BookingConfirmationEmail {
    currency?: string;
    totalPrice: number; // Required for PDF generation
}

export async function sendBookingConfirmationEmail(
    confirmation: BookingConfirmationEmail,
    includeTicketPdf = false
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

    const attachments: Array<{
        RawContent: Buffer;
        ContentType: string;
        ContentDisposition: string;
        ContentId?: string;
        ContentTransferEncoding: string;
        FileName: string;
    }> = [{
        RawContent: qrCode,
        ContentType: 'image/png',
        ContentDisposition: 'INLINE',
        ContentId: 'booking-reference-qr',
        ContentTransferEncoding: 'BASE64',
        FileName: 'booking-reference.png',
    }];

    // Optionally include the PDF ticket attachment
    if (includeTicketPdf && 'currency' in confirmation) {
        const confirmationWithTicket = confirmation as BookingConfirmationWithTicket;
        const ticketPdf = await generateTicketPdf({
            bookingRef: confirmation.bookingRef,
            movieTitle: confirmation.movieTitle,
            date: confirmation.date,
            time: confirmation.time,
            screen: confirmation.screen,
            seats: confirmation.seats,
            guestName: `${confirmation.customer.firstName} ${confirmation.customer.surname}`,
            ticketCount: confirmation.tickets,
            totalAmount: confirmationWithTicket.totalPrice,
            currency: confirmationWithTicket.currency || 'GBP',
        } as TicketPdfInput);

        attachments.push({
            RawContent: ticketPdf,
            ContentType: 'application/pdf',
            ContentDisposition: 'ATTACHMENT',
            ContentTransferEncoding: 'BASE64',
            FileName: `${confirmation.bookingRef.replace(/[^a-zA-Z0-9_-]/g, '-')}.pdf`,
        });
    }

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
                Attachments: attachments,
            },
        },
    }));
}
