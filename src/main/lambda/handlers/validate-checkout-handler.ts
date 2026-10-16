import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { PricingServiceError, validateCheckout } from './pricing-service';
import { json, log } from './utils/common';

export const handler = async (
    event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
    const requestId = event.requestContext?.requestId;
    if (!event.body) {
        return json(400, { message: 'A JSON request body is required.' });
    }

    let request: unknown;
    try {
        const body = event.isBase64Encoded
            ? Buffer.from(event.body, 'base64').toString('utf8')
            : event.body;
        request = JSON.parse(body);
    } catch {
        return json(400, { message: 'Request body must contain valid JSON.' });
    }

    try {
        return json(200, await validateCheckout(request));
    } catch (error: unknown) {
        if (error instanceof PricingServiceError) {
            if (error.statusCode >= 500) {
                log('ERROR', 'Failed to validate checkout', {
                    requestId,
                    error: error.message,
                });
            }
            return json(error.statusCode, { message: error.message });
        }
        log('ERROR', 'Failed to validate checkout', {
            requestId,
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        return json(500, { message: 'Unable to validate checkout.' });
    }
};
