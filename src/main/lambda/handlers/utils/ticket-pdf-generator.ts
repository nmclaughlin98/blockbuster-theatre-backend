import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

export interface TicketPdfInput {
  bookingRef: string;
  movieTitle: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  screen: string;
  seats: string[];
  guestName: string;
  ticketCount: number;
  totalAmount: number;
  currency: string; // GBP, USD, etc.
}

const COLORS = {
  dark: '#181b29',
  red: '#ff334b',
  redDark: '#B31E35',
  text: '#f8fafc',
  textMuted: '#8ea6c8',
  border: '#2f354d',
  white: '#ffffff',
};

/**
 * Generate a PDF ticket buffer in 9:16 aspect ratio (270×480 points).
 * This creates an in-memory PDF suitable for downloads and email attachments.
 */
export async function generateTicketPdf(input: TicketPdfInput): Promise<Buffer> {
  // QR code encodes the booking reference
  const qrCodeBuffer = await QRCode.toBuffer(input.bookingRef, {
    errorCorrectionLevel: 'M',
    margin: 0, // No margin; we'll add space via positioning
    width: 200, // Physical pixel size
    color: {
      dark: '#0c0d12',
      light: '#ffffff',
    },
  });

  // 9:16 aspect ratio: 270pt × 480pt (or 360×640pt at 1.33x scale)
  const pageWidth = 270;
  const pageHeight = 480;

  // Create PDF document with exact dimensions
  const doc = new PDFDocument({
    size: [pageWidth, pageHeight],
    margin: 0,
    bufferPages: true,
  });

  const buffer = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    doc.on('end', () => {
      resolve(Buffer.concat(chunks));
    });

    doc.on('error', reject);

    // Build the PDF content
    try {
      buildTicketContent(doc, input, qrCodeBuffer, pageWidth, pageHeight);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });

  return buffer;
}

function buildTicketContent(
  doc: PDFKit.PDFDocument,
  input: TicketPdfInput,
  qrCodeBuffer: Buffer,
  pageWidth: number,
  pageHeight: number
): void {
  const padding = 12;
  const contentWidth = pageWidth - 2 * padding;
  let y = padding;

  // ===== HEADER (Red banner with Blockbuster branding) =====
  doc.rect(0, 0, pageWidth, 48)
    .fillAndStroke(COLORS.red, COLORS.red);

  doc.font('Helvetica-Bold', 11)
    .fill(COLORS.white)
    .text('BLOCKBUSTER', padding, 8, { width: contentWidth, align: 'left' })
    .text('THEATRE', padding, 20, { width: contentWidth, align: 'left' });

  y = 48 + padding;

  // ===== MOVIE TITLE =====
  doc.font('Helvetica-Bold', 13)
    .fill(COLORS.text)
    .text(input.movieTitle, padding, y, {
      width: contentWidth,
      align: 'left',
      lineBreak: true,
    });

  const movieTitleHeight = 32; // Approximate
  y += movieTitleHeight;

  // ===== DETAILS GRID (2 columns) =====
  const colWidth = contentWidth / 2;
  const labelFontSize = 8;
  const valueFontSize = 11;
  const rowHeight = 24;

  const details: Array<{ label: string; value: string }> = [
    { label: 'SHOWTIME', value: `${formatDate(input.date)} ${input.time}` },
    { label: 'SCREEN', value: `Screen ${input.screen}` },
    { label: 'SEAT' + (input.seats.length === 1 ? '' : 'S'), value: input.seats.join(', ') },
    { label: 'GUEST NAME', value: input.guestName },
    { label: 'TICKET BREAKDOWN', value: `${input.ticketCount} ${input.ticketCount === 1 ? 'Ticket' : 'Tickets'}` },
    { label: 'TOTAL', value: `${input.currency}${input.totalAmount.toFixed(2)}` },
  ];

  // Draw detail rows (2 columns)
  for (let i = 0; i < details.length; i += 2) {
    const leftDetail = details[i];
    const rightDetail = details[i + 1];

    // Left column
    doc.font('Helvetica', labelFontSize)
      .fill(COLORS.textMuted)
      .text(leftDetail.label, padding, y, { width: colWidth - 6, align: 'left' });

    doc.font('Helvetica-Bold', valueFontSize)
      .fill(COLORS.text)
      .text(leftDetail.value, padding, y + 12, { width: colWidth - 6, align: 'left' });

    // Right column
    if (rightDetail) {
      doc.font('Helvetica', labelFontSize)
        .fill(COLORS.textMuted)
        .text(rightDetail.label, padding + colWidth, y, { width: colWidth - 6, align: 'left' });

      doc.font('Helvetica-Bold', valueFontSize)
        .fill(COLORS.text)
        .text(rightDetail.value, padding + colWidth, y + 12, { width: colWidth - 6, align: 'left' });
    }

    y += rowHeight;
  }

  // ===== PERFORATION LINE =====
  y += 6;
  const dashPattern = [4, 4];
  doc.moveTo(padding, y)
    .lineTo(pageWidth - padding, y)
    .dash(4, { space: 4 })
    .stroke(COLORS.border);
  doc.undash();

  y += 12;

  // ===== QR CODE (in white container) =====
  const qrSize = 140;
  const qrX = (pageWidth - qrSize) / 2;
  const qrY = y;

  // White background box for QR
  doc.rect(qrX - 6, qrY - 6, qrSize + 12, qrSize + 12)
    .fill(COLORS.white);

  // Embed QR code image
  doc.image(qrCodeBuffer, qrX, qrY, { width: qrSize, height: qrSize });

  y = qrY + qrSize + 12;

  // ===== BOOKING REFERENCE =====
  doc.font('Courier', 9)
    .fill(COLORS.textMuted)
    .text(`REF: ${input.bookingRef}`, padding, y, {
      width: contentWidth,
      align: 'center',
    });

  // PDF complete; no bottom margin or whitespace
}

function formatDate(dateString: string): string {
  // Input: YYYY-MM-DD
  // Output: Mon 14 Nov
  try {
    const date = new Date(`${dateString}T00:00:00Z`);
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    })
      .format(date)
      .replace(/,/g, ''); // Remove commas if any
  } catch {
    return dateString;
  }
}
