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
    'UNPAID BOOKING RESERVATION - NO PAYMENT WAS PROCESSED',
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
    'Your seat reservation has been recorded, but payment has not been processed. This email is not an admission ticket.',
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

function formatScreeningDate(date, time) {
  const parsedDate = new Date(`${date}T00:00:00Z`);
  const formattedDate = !Number.isNaN(parsedDate.getTime())
    && parsedDate.toISOString().slice(0, 10) === date
    ? new Intl.DateTimeFormat('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(parsedDate).replace(',', '')
    : date;

  return `${formattedDate} at ${time}`;
}

export function formatBookingConfirmationEmailHtml(
  booking: BookingConfirmationEmail
): string {
  const details: Array<[string, string]> = [
    ['SHOWTIME', `${formatScreeningDate(booking.date, booking.time)}`],
    ['SCREEN', `Screen ${booking.screen}`],
    [`Seat${booking.seats.length === 1 ? '' : 's'}`, booking.seats.join(', ')],
    ['GUEST NAME', `${booking.customer.firstName} ${booking.customer.surname}`],
    ['TICKET BREAKDOWN', `${booking.tickets} ${booking.tickets === 1 ? 'Ticket' : 'Tickets'}`],
    ['TOTAL', `£${booking.totalPrice.toFixed(2)}`],
  ];
  const detailCell = ([label, value]: [string, string]) => `
        <td class="ticket-detail-cell" width="50%" valign="top">
          <div class="ticket-label">${escapeHtml(label)}</div>
          <div class="ticket-text">${escapeHtml(value)}</div>
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
    :root {
      color-scheme: dark;
      supported-color-schemes: dark;
    }

    body.email-background {
      margin: 0;
      padding: 0;
      color: #f8fafc;
      color-scheme: dark;
      font-family: Arial, Helvetica, sans-serif;
    }

    .email-preheader {
      display: none;
      max-height: 0;
      overflow: hidden;
      opacity: 0;
      color: #0c0d12;
    }

    table.email-background {
      color-scheme: dark;
    }

    .email-content {
      padding: 28px 12px;
    }

    .ticket-card {
      width: 100%;
      max-width: 600px;
      background-color: #343744;
      border: 1px solid #303030;
      border-radius: 16px;
      overflow: hidden;
      color-scheme: dark;
    }

    .ticket-header {
      padding: 17px 20px;
      background-color: #ff334b;
      background-image: linear-gradient(#ff334b, #B31E35);
    }

    .ticket-brand {
      font-family: Impact, 'Arial Narrow', Arial, sans-serif;
      font-size: 25px;
      letter-spacing: 1px;
      color: #ffffff;
      -webkit-text-fill-color: #ffffff;
    }

    .ticket-demo-badge {
      display: inline-block;
      padding: 10px 15px;
      border-radius: 999px;
      background-color: #b31e35;
      background-image: linear-gradient(#b31e35, #b31e35);
      color: #ffffff;
      -webkit-text-fill-color: #ffffff;
      font-size: 12px;
      font-weight: bold;
      letter-spacing: 0.6px;
    }

    .ticket-title-cell {
      padding: 20px 18px 6px;
    }

    .ticket-title {
      margin: 0;
      color: #f8fafc;
      -webkit-text-fill-color: #f8fafc;
      font-family: Impact, 'Arial Narrow', Arial, sans-serif;
      font-size: 36px;
      font-weight: normal;
      line-height: 1.25;
    }

    .ticket-details-cell {
      padding: 0 18px 12px;
    }

    .ticket-detail-cell {
      width: 50%;
      padding: 11px 12px 9px 0;
    }

    .ticket-label {
      margin: 0 0 5px;
      color: #8ea6c8;
      -webkit-text-fill-color: #8ea6c8;
      font-family: Arial, sans-serif;
      font-size: 10px;
      font-weight: bold;
      letter-spacing: 1px;
    }

    .ticket-text {
      margin: 0;
      color: #f8fafc;
      -webkit-text-fill-color: #f8fafc;
      font-family: Arial, sans-serif;
      font-size: 14px;
      font-weight: bold;
      line-height: 1.4;
    }

    .ticket-divider {
      padding: 0 0 5px;
      border-top: 2px dashed #2f354d;
      font-size: 0;
      line-height: 0;
    }

    .ticket-qr-cell {
      padding: 8px 18px 4px;
    }

    .ticket-qr-panel {
      background-color: #ffffff;
      background-image: linear-gradient(#ffffff, #ffffff);
      border-radius: 6px;
      color-scheme: light;
    }

    .ticket-qr-image-cell {
      padding: 10px;
    }

    .ticket-qr-image {
      display: block;
      width: 144px;
      height: 144px;
      border: 0;
    }

    .ticket-reference {
      padding: 12px 18px 7px;
      color: #b6c7e1;
      -webkit-text-fill-color: #b6c7e1;
      font-family: 'Courier New', monospace;
      font-size: 11px;
      letter-spacing: 2px;
    }

    .ticket-muted {
      padding: 12px 18px;
      border-top: 1px solid #2f354d;
      color: #94a3b8;
      -webkit-text-fill-color: #94a3b8;
      font-size: 10px;
      line-height: 1.5;
      text-align: center;
    }

    @media (prefers-color-scheme: dark) {

      body,
      .email-background {
        color: #f8fafc !important;
      }

      .ticket-card {
        background-color: #181b29 !important;
      }

      .ticket-header {
        background-image: linear-gradient(#ff334b, #B31E35);
      }

      .ticket-demo-warning {
        background-color: #2a1820 !important;
        color: #ffb2bd !important;
      }

      .ticket-demo-badge {
        background-color: #b31e35 !important;
        color: #ffffff !important;
      }

      .ticket-text {
        color: #f8fafc !important;
      }

      .ticket-muted {
        color: #94a3b8 !important;
      }

      .ticket-label {
        color: #8ea6c8 !important;
      }

      .ticket-reference {
        color: #b6c7e1 !important;
      }

      .ticket-qr-panel {
        background-color: #ffffff !important;
      }
    }
  </style>
  <title>Booking Confirmation</title>
</head>

<body class="email-background">
  <div class="email-preheader">Your Blockbuster Theatre booking details and reference.</div>
  <table class="email-background" role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td class="email-content" align="center">
        <table class="ticket-card" role="presentation" width="600" cellspacing="0" cellpadding="0" border="0">
          <tr>
            <td class="ticket-header">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td class="ticket-brand">BLOCKBUSTER<br />THEATRE</td>
                  <td align="right"><span class="ticket-demo-badge">BOOKING CONFIRMED</span></td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="ticket-title-cell">
              <h1 class="ticket-title">${movieTitle}</h1>
            </td>
          </tr>
          <tr>
            <td class="ticket-details-cell">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                ${detailRows}
              </table>
            </td>
          </tr>
          <tr>
            <td class="ticket-divider">&nbsp;</td>
          </tr>
          <tr>
            <td class="ticket-qr-cell" align="center">
              <table class="ticket-qr-panel" role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td class="ticket-qr-image-cell" align="center"><img class="ticket-qr-image"
                      src="cid:booking-reference-qr" width="144" height="144"
                      alt="QR code encoding reference ${bookingRef} only"></td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="ticket-reference" align="center">REF: ${bookingRef}</td>
          </tr>
          <tr>
          </tr>
          <tr>
            <td class="ticket-muted">No payment was taken, no reservation was created, and no valid ticket was issued.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>

</html>`;
}
