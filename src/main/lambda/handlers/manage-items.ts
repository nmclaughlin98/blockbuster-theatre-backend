import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.TABLE_NAME || '';

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    const method = event.requestContext.http.method;

    try {
        if (method === 'GET') {
            const id = event.pathParameters?.id;
            if (!id) return { statusCode: 400, body: JSON.stringify({ error: 'Missing ID' }) };

            const result = await docClient.send(new GetCommand({
                TableName: TABLE_NAME,
                Key: { id },
            }));

            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(result.Item || {}),
            };
        }

        if (method === 'POST') {
            if (!event.body) return { statusCode: 400, body: JSON.stringify({ error: 'Missing body' }) };

            const body = JSON.parse(event.body);

            await docClient.send(new PutCommand({
                TableName: TABLE_NAME,
                Item: body,
            }));

            return {
                statusCode: 201,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: 'Item saved successfully' }),
            };
        }

        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    } catch (error: any) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message || 'Internal Error' }),
        };
    }
};
