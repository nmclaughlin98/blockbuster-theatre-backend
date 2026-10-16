import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { createDynamoDBClient } from '../../main/lambda/handlers/dynamodb-client';

describe('DynamoDB client local endpoint guard', () => {
    const originalLocalApi = process.env.LOCAL_API;
    const originalDatabaseMode = process.env.LOCAL_API_DATABASE;
    const originalEndpoint = process.env.DYNAMODB_ENDPOINT;

    afterEach(() => {
        if (originalLocalApi === undefined) delete process.env.LOCAL_API;
        else process.env.LOCAL_API = originalLocalApi;
        if (originalDatabaseMode === undefined) delete process.env.LOCAL_API_DATABASE;
        else process.env.LOCAL_API_DATABASE = originalDatabaseMode;
        if (originalEndpoint === undefined) delete process.env.DYNAMODB_ENDPOINT;
        else process.env.DYNAMODB_ENDPOINT = originalEndpoint;
    });

    it('uses the AWS default client when no local endpoint is configured', () => {
        delete process.env.LOCAL_API;
        delete process.env.LOCAL_API_DATABASE;
        delete process.env.DYNAMODB_ENDPOINT;

        expect(createDynamoDBClient()).toBeInstanceOf(DynamoDBClient);
    });

    it('rejects a local endpoint unless local database mode is explicitly enabled', () => {
        delete process.env.LOCAL_API;
        delete process.env.LOCAL_API_DATABASE;
        process.env.DYNAMODB_ENDPOINT = 'http://127.0.0.1:8000';

        expect(() => createDynamoDBClient()).toThrow(
            'DYNAMODB_ENDPOINT is only supported for LOCAL_API_DATABASE=local.'
        );
    });

    it('requires an endpoint when local database mode is enabled', () => {
        process.env.LOCAL_API = 'true';
        process.env.LOCAL_API_DATABASE = 'local';
        delete process.env.DYNAMODB_ENDPOINT;

        expect(() => createDynamoDBClient()).toThrow(
            'DYNAMODB_ENDPOINT is required when LOCAL_API_DATABASE=local.'
        );
    });

    it('rejects non-local endpoints in local database mode', () => {
        process.env.LOCAL_API = 'true';
        process.env.LOCAL_API_DATABASE = 'local';
        process.env.DYNAMODB_ENDPOINT = 'https://dynamodb.eu-west-2.amazonaws.com';

        expect(() => createDynamoDBClient()).toThrow(
            'Local DynamoDB must use http://localhost:8000 or http://127.0.0.1:8000.'
        );
    });

    it('accepts only the configured local endpoint in local database mode', () => {
        process.env.LOCAL_API = 'true';
        process.env.LOCAL_API_DATABASE = 'local';
        process.env.DYNAMODB_ENDPOINT = 'http://127.0.0.1:8000';

        expect(createDynamoDBClient()).toBeInstanceOf(DynamoDBClient);
    });

    it('uses the AWS default client for the local API cloud database mode', () => {
        process.env.LOCAL_API = 'true';
        process.env.LOCAL_API_DATABASE = 'cloud';
        delete process.env.DYNAMODB_ENDPOINT;

        expect(createDynamoDBClient()).toBeInstanceOf(DynamoDBClient);
    });

    it('rejects a custom endpoint in local API cloud database mode', () => {
        process.env.LOCAL_API = 'true';
        process.env.LOCAL_API_DATABASE = 'cloud';
        process.env.DYNAMODB_ENDPOINT = 'https://dynamodb.eu-west-2.amazonaws.com';

        expect(() => createDynamoDBClient()).toThrow(
            'DYNAMODB_ENDPOINT is only supported for LOCAL_API_DATABASE=local.'
        );
    });
});
