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
  card: '#191b29',
  red: '#d83b4b',
  text: '#f8fafc',
  textMuted: '#78849b',
  border: '#363b4b',
  white: '#ffffff',
  page: '#f1f2f4',
};

const PAGE_WIDTH = 390;
const PAGE_HEIGHT = 483;
const CARD_INSET = 4;
const CARD_RADIUS = 16;
const PADDING = 16;

export async function generateTicketPdf(input: TicketPdfInput): Promise<Buffer> {
  const qrCodeBuffer = await QRCode.toBuffer(input.bookingRef, {
    errorCorrectionLevel: 'M',
    margin: 0,
    width: 200,
    color: {
      dark: '#0c0d12',
      light: COLORS.white,
    },
  });

  const doc = new PDFDocument({
    size: [PAGE_WIDTH, PAGE_HEIGHT],
    margin: 0,
    bufferPages: true,
  });

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      buildTicketContent(doc, input, qrCodeBuffer);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

function buildTicketContent(
  doc: PDFKit.PDFDocument,
  input: TicketPdfInput,
  qrCodeBuffer: Buffer
): void {
  const cardX = CARD_INSET;
  const cardY = CARD_INSET;
  const cardWidth = PAGE_WIDTH - CARD_INSET * 2;
  const cardHeight = PAGE_HEIGHT - CARD_INSET * 2;
  const contentWidth = cardWidth - PADDING * 2;

  doc.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT).fill(COLORS.page);
  doc.roundedRect(cardX, cardY, cardWidth, cardHeight, CARD_RADIUS)
    .fillAndStroke(COLORS.card, COLORS.border);

  const headerHeight = 68;
  doc.roundedRect(cardX, cardY, cardWidth, headerHeight, CARD_RADIUS).fill(COLORS.red);
  doc.rect(cardX, cardY + CARD_RADIUS, cardWidth, headerHeight - CARD_RADIUS).fill(COLORS.red);

  doc.font('Helvetica-Bold')
    .fontSize(18)
    .fill(COLORS.white)
    .text('BLOCKBUSTER', cardX + PADDING, cardY + 16, {
      width: contentWidth,
      characterSpacing: 1.8,
      lineBreak: false,
    })
    .text('THEATRE', cardX + PADDING, cardY + 36, {
      width: contentWidth,
      characterSpacing: 1.8,
      lineBreak: false,
    });

  doc.font('Helvetica-Bold')
    .fontSize(21)
    .fill(COLORS.text)
    .text(input.movieTitle, cardX + PADDING, 88, {
      width: contentWidth,
      height: 30,
      ellipsis: true,
      lineBreak: false,
    });

  const columnWidth = contentWidth / 2;
  const details = [
    { label: 'SHOWTIME', value: `${formatDate(input.date)} - ${input.time}` },
    { label: 'SCREEN', value: `Screen ${input.screen}` },
    { label: input.seats.length === 1 ? 'SEAT' : 'SEATS', value: input.seats.join(', ') },
    { label: 'GUEST NAME', value: input.guestName },
    { label: 'TICKET BREAKDOWN', value: `${input.ticketCount} ${input.ticketCount === 1 ? 'Ticket' : 'Tickets'}` },
    { label: 'TOTAL', value: formatCurrency(input.totalAmount, input.currency) },
  ];

  for (let index = 0; index < details.length; index += 2) {
    const rowY = 137 + (index / 2) * 45;
    const leftDetail = details[index];
    const rightDetail = details[index + 1];

    doc.font('Helvetica')
      .fontSize(9)
      .fill(COLORS.textMuted)
      .text(leftDetail.label, cardX + PADDING, rowY, {
        width: columnWidth - 8,
        lineBreak: false,
      });

    doc.font('Helvetica-Bold')
      .fontSize(13)
      .fill(COLORS.text)
      .text(leftDetail.value, cardX + PADDING, rowY + 14, {
        width: columnWidth - 8,
        height: 18,
        ellipsis: true,
        lineBreak: false,
      });

    doc.font('Helvetica')
      .fontSize(9)
      .fill(COLORS.textMuted)
      .text(rightDetail.label, cardX + PADDING + columnWidth, rowY, {
        width: columnWidth - 8,
        lineBreak: false,
      });

    doc.font('Helvetica-Bold')
      .fontSize(13)
      .fill(COLORS.text)
      .text(rightDetail.value, cardX + PADDING + columnWidth, rowY + 14, {
        width: columnWidth - 8,
        height: 18,
        ellipsis: true,
        lineBreak: false,
      });
  }

  const dividerY = 282;
  doc.moveTo(cardX, dividerY)
    .lineTo(cardX + cardWidth, dividerY)
    .dash(4, { space: 4 })
    .stroke(COLORS.border);
  doc.undash();

  const qrPanelSize = 144;
  const qrPanelX = (PAGE_WIDTH - qrPanelSize) / 2;
  const qrPanelY = 300;
  const qrSize = 88;
  doc.roundedRect(qrPanelX, qrPanelY, qrPanelSize, qrPanelSize, 7).fill(COLORS.white);
  doc.image(qrCodeBuffer, (PAGE_WIDTH - qrSize) / 2, qrPanelY + (qrPanelSize - qrSize) / 2, {
    width: qrSize,
    height: qrSize,
  });

  doc.font('Courier')
    .fontSize(9)
    .fill(COLORS.textMuted)
    .text(`REF: ${input.bookingRef}`, cardX + PADDING, 458, {
      width: contentWidth,
      align: 'center',
      characterSpacing: 1.4,
      lineBreak: false,
    });
}

function formatCurrency(amount: number, currency: string): string {
  const symbols: Record<string, string> = {
    GBP: '£',
    USD: '$',
    EUR: '€',
  };
  const symbol = symbols[currency] ?? `${currency} `;
  return `${symbol}${amount.toFixed(2)}`;
}

function formatDate(dateString: string): string {
  const date = new Date(`${dateString}T00:00:00Z`);
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date).replace(/,/g, '');
}
