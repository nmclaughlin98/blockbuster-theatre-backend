import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient, GetCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommandInput, GetCommand as DocGetCommand } from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { generateTicketPdf, type TicketPdfInput } from './utils/ticket-pdf-generator';

const dynamoDbClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({}),
  { marshallOptions: { removeUndefinedValues: true } }
);

const BOOKINGS_TABLE = process.env.BOOKINGS_TABLE_NAME;

/**
 * Lambda handler for GET /bookings/{bookingId}/ticket
 * 
 * Fetches a booking from DynamoDB and returns a generated PDF ticket.
 * Authentication: Caller must be the userId who owns the booking (via JWT).
 */
export async function handler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  try {
    // Extract booking ID from path
    const bookingId = event.pathParameters?.bookingId;
    if (!bookingId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing bookingId in path' }),
      };
    }

    // Extract and verify caller's userId from JWT claims
    const claims = event.requestContext.authorizer?.claims as Record<string, unknown>;
    const callerId = claims?.sub as string | undefined;
    if (!callerId) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Unauthorized: No valid JWT claims' }),
      };
    }

    // Fetch the booking from DynamoDB
    if (!BOOKINGS_TABLE) {
      throw new Error('BOOKINGS_TABLE_NAME is not configured');
    }

    const bookingData = await dynamoDbClient.send(
      new DocGetCommand({
        TableName: BOOKINGS_TABLE,
        Key: { bookingId },
      } as GetCommandInput)
    );

    if (!bookingData.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Booking not found' }),
      };
    }

    const booking = bookingData.Item as Record<string, unknown>;

    // Verify the caller owns this booking
    if (booking.userId !== callerId) {
      return {
        statusCode: 403,
        body: JSON.stringify({ error: 'Forbidden: Booking belongs to another user' }),
      };
    }

    // Validate required fields
    const requiredFields = ['bookingRef', 'movieTitle', 'date', 'time', 'screen', 'guestName', 'ticketCount', 'totalAmount'];
    const missing = requiredFields.filter(field => !booking[field]);
    if (missing.length > 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: `Booking missing required fields: ${missing.join(', ')}` }),
      };
    }

    // Prepare PDF input
    const seats = Array.isArray(booking.seats) ? (booking.seats as string[]) : [];
    const pdfInput: TicketPdfInput = {
      bookingRef: String(booking.bookingRef),
      movieTitle: String(booking.movieTitle),
      date: String(booking.date),
      time: String(booking.time),
      screen: String(booking.screen),
      seats,
      guestName: String(booking.guestName),
      ticketCount: Number(booking.ticketCount),
      totalAmount: Number(booking.totalAmount),
      currency: String(booking.currency || 'GBP'),
    };

    // Generate PDF
    const pdfBuffer = await generateTicketPdf(pdfInput);

    // Return PDF with proper headers
    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${pdfInput.bookingRef.replace(/[^a-zA-Z0-9_-]/g, '-')}.pdf"`,
        'Content-Length': String(pdfBuffer.length),
      },
      body: pdfBuffer.toString('base64'),
    };
  } catch (error) {
    console.error('Error generating ticket PDF:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Could not generate PDF ticket',
        message: error instanceof Error ? error.message : String(error),
      }),
    };
  }
}
