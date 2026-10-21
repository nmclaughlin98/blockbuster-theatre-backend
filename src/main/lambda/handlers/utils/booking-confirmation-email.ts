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
    `Total: £${booking.totalPrice.toFixed(2)}`,
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
    ['DATE & SHOWTIME', `${booking.date} at ${booking.time}`],
    ['SCREEN', `Screen ${booking.screen}`],
    ['SEAT NUMBERS', booking.seats.join(', ')],
    ['TOTAL', `£${booking.totalPrice.toFixed(2)}`],
    ['GUEST NAME', `${booking.customer.firstName} ${booking.customer.surname}`],
    ['TICKET BREAKDOWN', `${booking.tickets} ${booking.tickets === 1 ? 'Ticket' : 'Tickets'}`],
  ];
  const detailCell = ([label, value]: [string, string]) => `
        <td width="50%" valign="top" style="width:50%;padding:11px 12px 9px 0;">
          <div class="ticket-label" style="margin:0 0 5px;color:#8ea6c8;-webkit-text-fill-color:#8ea6c8;font-family:Arial,sans-serif;font-size:10px;font-weight:bold;letter-spacing:1px;">${escapeHtml(label)}</div>
          <div class="ticket-text" style="margin:0;color:#f8fafc;-webkit-text-fill-color:#f8fafc;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;line-height:1.4;">${escapeHtml(value)}</div>
        </td>`;
  const detailRows = Array.from({ length: Math.ceil(details.length / 2) }, (_, index) => `
        <tr>
          ${detailCell(details[index * 2])}
          ${detailCell(details[index * 2 + 1])}
        </tr>`).join('');
  const bookingRef = escapeHtml(booking.bookingRef);
  const guestName = escapeHtml(`${booking.customer.firstName} ${booking.customer.surname}`);
  const movieTitle = escapeHtml(booking.movieTitle);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <style>
    :root { color-scheme: dark; supported-color-schemes: dark; }
    @media (prefers-color-scheme: dark) {
      body, .email-background { background-color:#0c0d12 !important; color:#f8fafc !important; }
      .ticket-card { background-color:#343744 !important; }
      .ticket-header { background-color:#ff334b !important; }
      .ticket-demo-warning { background-color:#2a1820 !important; color:#ffb2bd !important; }
      .ticket-demo-badge { background-color:#b31e35 !important; color:#ffffff !important; }
      .ticket-text { color:#f8fafc !important; }
      .ticket-muted { color:#94a3b8 !important; }
      .ticket-label { color:#8ea6c8 !important; }
      .ticket-reference { color:#b6c7e1 !important; }
      .ticket-qr-panel { background-color:#ffffff !important; }
    }
  </style>
  <title>Booking Confirmation</title>
</head>
<body class="email-background" style="margin:0;padding:0;background-color:#0c0d12;background-image:linear-gradient(#0c0d12,#0c0d12);color:#f8fafc;color-scheme:dark;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#0c0d12;">Your Blockbuster Theatre booking details and reference.</div>
  <table class="email-background" role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#0c0d12" style="background-color:#0c0d12;background-image:linear-gradient(#0c0d12,#0c0d12);color-scheme:dark;">
    <tr>
      <td align="center" style="padding:28px 12px;">
        <table class="ticket-card" role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" bgcolor="#343744" style="width:100%;max-width:600px;background-color:#343744;background-image:linear-gradient(#343744,#343744);border:1px solid #454957;border-radius:16px;overflow:hidden;color-scheme:dark;">
          <tr>
            <td class="ticket-header" bgcolor="#ff334b" style="padding:17px 20px;background-color:#ff334b;background-image:linear-gradient(#ff334b,#ff334b);">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="font-family:Impact,'Arial Narrow',Arial,sans-serif;font-size:17px;font-weight:bold;letter-spacing:1px;color:#ffffff;-webkit-text-fill-color:#ffffff;">BLOCKBUSTER THEATRE</td>
                  <td align="right"><span class="ticket-demo-badge" style="display:inline-block;padding:6px 9px;border-radius:999px;background-color:#b31e35;background-image:linear-gradient(#b31e35,#b31e35);color:#ffffff;-webkit-text-fill-color:#ffffff;font-size:9px;font-weight:bold;letter-spacing:0.6px;">Booking Confirmed</span></td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 18px 6px;">
              <h1 class="ticket-text" style="margin:0;color:#f8fafc;-webkit-text-fill-color:#f8fafc;font-family:Impact,'Arial Narrow',Arial,sans-serif;font-size:36px;font-weight:normal;line-height:1.25;">${movieTitle}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:10px 18px 14px;">
              <table class="ticket-demo-warning" role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#2a1820" style="background-color:#2a1820;background-image:linear-gradient(#2a1820,#2a1820);border:1px solid #71303b;border-radius:8px;">
                <tr>
                  <td align="center" style="padding:9px 11px;color:#ffb2bd;-webkit-text-fill-color:#ffb2bd;font-size:10px;font-weight:bold;letter-spacing:0.4px;line-height:1.5;text-align:center;">DEMO ONLY - NO PAYMENT WAS PROCESSED. This is not a valid ticket or seat reservation. If you turn up, you will be judged, heavily.</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 18px 12px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                ${detailRows}
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 0 1px;border-top:1px dashed #737887;font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <tr>
            <td class="ticket-reference" align="center" style="padding:12px 18px 7px;color:#b6c7e1;-webkit-text-fill-color:#b6c7e1;font-family:'Courier New',monospace;font-size:11px;letter-spacing:2px;">REF: ${bookingRef}</td>
          </tr>
          <tr>
            <td align="center" style="padding:8px 18px 4px;">
              <table class="ticket-qr-panel" role="presentation" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="background-color:#ffffff;background-image:linear-gradient(#ffffff,#ffffff);border-radius:6px;color-scheme:light;">
                <tr>
                  <td align="center" style="padding:10px;"><img src="cid:booking-reference-qr" width="144" height="144" alt="QR code encoding reference ${bookingRef} only" style="display:block;width:144px;height:144px;border:0;"></td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="ticket-muted" align="center" style="padding:3px 18px 16px;color:#94a3b8;-webkit-text-fill-color:#94a3b8;font-size:9px;font-weight:bold;letter-spacing:1px;">REFERENCE ONLY - NOT VALID FOR ENTRY</td>
          </tr>
          <tr>
          </tr>
          <tr>
            <td class="ticket-muted" style="padding:12px 18px;border-top:1px solid #4a4e5b;color:#94a3b8;-webkit-text-fill-color:#94a3b8;font-size:10px;line-height:1.5;text-align:center;">No payment was taken, no reservation was created, and no valid ticket was issued.</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
