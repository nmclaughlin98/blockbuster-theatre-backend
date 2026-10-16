import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

export function createDynamoDBClient(): DynamoDBClient {
    const endpoint = process.env.DYNAMODB_ENDPOINT;
    const isLocalApi = process.env.LOCAL_API === 'true';
    const databaseMode = process.env.LOCAL_API_DATABASE;

    if (!endpoint) {
        if (isLocalApi && databaseMode === 'local') {
            throw new Error(
                'DYNAMODB_ENDPOINT is required when LOCAL_API_DATABASE=local.'
            );
        }
        return new DynamoDBClient({});
    }

    if (!isLocalApi || databaseMode !== 'local') {
        throw new Error(
            'DYNAMODB_ENDPOINT is only supported for LOCAL_API_DATABASE=local.'
        );
    }

    const parsedEndpoint = new URL(endpoint);
    if (
        parsedEndpoint.protocol !== 'http:' ||
        !LOCAL_HOSTS.has(parsedEndpoint.hostname) ||
        parsedEndpoint.port !== '8000'
    ) {
        throw new Error(
            'Local DynamoDB must use http://localhost:8000 or http://127.0.0.1:8000.'
        );
    }

    return new DynamoDBClient({
        endpoint: parsedEndpoint.toString(),
        region: process.env.AWS_REGION ?? 'eu-west-2',
        credentials: {
            accessKeyId: 'local',
            secretAccessKey: 'local',
        },
    });
}
