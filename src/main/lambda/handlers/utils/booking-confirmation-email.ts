export interface BookingConfirmationEmail {
    bookingRef: string;
    customer: {
        firstName: string;
        surname: string;
        email: string;
        phone?: string;
    };
    movieTitle: string;
    date: string;
    time: string;
    screen: string;
    seats: string[];
    tickets: number;
    totalPrice: number;
}

export function formatBookingConfirmationEmailBody(
    booking: BookingConfirmationEmail
): string {
    return [
        'DEMO BOOKING CONFIRMATION - NO PAYMENT WAS PROCESSED',
        '',
        `Booking reference: ${booking.bookingRef}`,
        `Name: ${booking.customer.firstName} ${booking.customer.surname}`,
        `Movie: ${booking.movieTitle}`,
        `Date: ${booking.date}`,
        `Time: ${booking.time}`,
        `Screen: ${booking.screen}`,
        `Seats: ${booking.seats.join(', ')}`,
        `Tickets: ${booking.tickets}`,
        `Demo total: GBP ${booking.totalPrice.toFixed(2)}`,
        ...(booking.customer.phone ? [`Phone: ${booking.customer.phone}`] : []),
        '',
        'QR code: encodes the booking reference only and is not valid for entry.',
        'This is a demo booking only. No payment was taken and this email is not a valid cinema ticket.',
    ].join('\n');
}

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => {
        const entities: Record<string, string> = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        };
        return entities[character];
    });
}

export function formatBookingConfirmationEmailHtml(
    booking: BookingConfirmationEmail
): string {
    const details: Array<[string, string]> = [
        ['MOVIE', booking.movieTitle],
        ['DATE', booking.date],
        ['SHOWTIME', `${booking.time} - Screen ${booking.screen}`],
        ['SEATS', booking.seats.join(', ')],
        ['TICKETS', String(booking.tickets)],
    ];
    const detailRows = details.map(([label, value]) => `
        <tr>
          <td style="padding:12px 16px;color:#94a3b8;font-family:Arial,sans-serif;font-size:12px;font-weight:bold;letter-spacing:1px;">${label}</td>
          <td align="right" style="padding:12px 16px;color:#f8fafc;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">${escapeHtml(value)}</td>
        </tr>`).join('');
    const phoneRow = booking.customer.phone
        ? `<tr><td style="padding:12px 16px;color:#94a3b8;font-family:Arial,sans-serif;font-size:12px;font-weight:bold;letter-spacing:1px;">PHONE</td><td align="right" style="padding:12px 16px;color:#f8fafc;font-family:Arial,sans-serif;font-size:15px;">${escapeHtml(booking.customer.phone)}</td></tr>`
        : '';
    const bookingRef = escapeHtml(booking.bookingRef);
    const guestName = escapeHtml(`${booking.customer.firstName} ${booking.customer.surname}`);

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Demo booking confirmation</title>
</head>
<body style="margin:0;padding:0;background-color:#0c0d12;color:#f8fafc;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#0c0d12;">Your Blockbuster Theatre demo booking details and reference.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#0c0d12">
    <tr>
      <td align="center" style="padding:32px 12px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background-color:#13151f;border:1px solid #292d3b;border-radius:16px;overflow:hidden;">
          <tr>
            <td style="height:5px;background-color:#ff334b;font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:24px 28px 18px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="font-family:Impact,'Arial Narrow',Arial,sans-serif;font-size:21px;font-weight:bold;letter-spacing:1.5px;color:#f8fafc;">BLOCKBUSTER <span style="color:#ff334b;">THEATRE</span></td>
                  <td align="right"><span style="display:inline-block;padding:7px 11px;border:1px solid #7b3540;border-radius:999px;color:#ff8a99;font-size:10px;font-weight:bold;letter-spacing:1.2px;">DEMO BOOKING</span></td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 24px;">
              <p style="margin:0 0 8px;color:#34d399;font-size:11px;font-weight:bold;letter-spacing:2px;">BOOKING PREVIEW</p>
              <h1 style="margin:0;color:#f8fafc;font-family:Impact,'Arial Narrow',Arial,sans-serif;font-size:32px;font-weight:normal;letter-spacing:0.5px;line-height:1.15;">Your night at the movies</h1>
              <p style="margin:12px 0 0;color:#94a3b8;font-size:15px;line-height:1.6;">Hi ${guestName}, here is your demo booking summary.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 22px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#2a1820" style="border:1px solid #71303b;border-radius:10px;">
                <tr>
                  <td style="padding:14px 16px;color:#ffb2bd;font-size:12px;font-weight:bold;letter-spacing:0.6px;line-height:1.6;">DEMO ONLY - NO PAYMENT WAS PROCESSED. This is not a valid cinema ticket or seat reservation.</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 22px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#1a1d2e" style="border:1px solid #303447;border-radius:12px;">
                <tr>
                  <td colspan="2" style="padding:16px 16px 8px;color:#94a3b8;font-size:11px;font-weight:bold;letter-spacing:1.5px;">BOOKING REFERENCE</td>
                </tr>
                <tr>
                  <td style="padding:0 16px 16px;color:#f8fafc;font-family:Impact,'Arial Narrow',Arial,sans-serif;font-size:28px;letter-spacing:2px;">${bookingRef}</td>
                  <td align="right" style="padding:0 16px 16px;color:#ff8a99;font-size:11px;font-weight:bold;letter-spacing:1px;">DEMO</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 22px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#1a1d2e" style="border:1px solid #303447;border-radius:12px;">
                ${detailRows}
                ${phoneRow}
                <tr>
                  <td style="padding:14px 16px;border-top:1px solid #3a3e4d;color:#94a3b8;font-size:12px;font-weight:bold;letter-spacing:1px;">DEMO TOTAL</td>
                  <td align="right" style="padding:14px 16px;border-top:1px solid #3a3e4d;color:#ff8a99;font-size:18px;font-weight:bold;">GBP ${booking.totalPrice.toFixed(2)}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0 28px 28px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="border-radius:12px;">
                <tr>
                  <td align="center" style="padding:16px 24px 8px;color:#0c0d12;font-size:12px;font-weight:bold;letter-spacing:1px;">YOUR BOOKING REFERENCE QR</td>
                </tr>
                <tr>
                  <td align="center" style="padding:4px 24px 8px;"><img src="cid:booking-reference-qr" width="192" height="192" alt="QR code containing booking reference ${bookingRef}" style="display:block;width:192px;height:192px;border:0;"></td>
                </tr>
                <tr>
                  <td align="center" style="padding:0 24px 16px;color:#475569;font-size:11px;line-height:1.5;">Encodes ${bookingRef} only. It cannot be used for cinema entry.</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px;border-top:1px solid #292d3b;color:#64748b;font-size:11px;line-height:1.6;text-align:center;">This demonstration does not process payment, create a reservation, or issue a ticket.<br>Blockbuster Theatre</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
