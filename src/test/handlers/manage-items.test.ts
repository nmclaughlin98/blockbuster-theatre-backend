import { handler } from '../../main/lambda/handlers/manage-items';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';

const ddbMock = mockClient(DynamoDBDocumentClient);

// Mock environment variable
process.env.TABLE_NAME = 'test-table';

describe('Manage Items Lambda Handler', () => {
    beforeEach(() => {
        ddbMock.reset();
    });

    describe('GET /items/{id}', () => {
        it('should return 400 when id is missing', async () => {
            const event = {
                requestContext: { http: { method: 'GET' } },
                pathParameters: {},
            } as any;

            const result = (await handler(event)) as any;

            expect(result.statusCode).toBe(400);
            expect(JSON.parse(result.body).error).toBe('Missing ID');
        });

        it('should retrieve an item from DynamoDB', async () => {
            const mockItem = { id: '123', name: 'Test Item' };
            ddbMock.on(GetCommand).resolves({ Item: mockItem });

            const event = {
                requestContext: { http: { method: 'GET' } },
                pathParameters: { id: '123' },
            } as any;

            const result = (await handler(event)) as any;

            expect(result.statusCode).toBe(200);
            expect(result.headers?.['Content-Type']).toBe('application/json');
            expect(JSON.parse(result.body)).toEqual(mockItem);
        });

        it('should return empty object when item is not found', async () => {
            ddbMock.on(GetCommand).resolves({ Item: undefined });

            const event = {
                requestContext: { http: { method: 'GET' } },
                pathParameters: { id: 'non-existent' },
            } as any;

            const result = (await handler(event)) as any;

            expect(result.statusCode).toBe(200);
            expect(JSON.parse(result.body)).toEqual({});
        });

        it('should handle DynamoDB errors', async () => {
            ddbMock.on(GetCommand).rejects(new Error('DynamoDB Error'));

            const event = {
                requestContext: { http: { method: 'GET' } },
                pathParameters: { id: '123' },
            } as any;

            const result = (await handler(event)) as any;

            expect(result.statusCode).toBe(500);
            expect(JSON.parse(result.body).error).toBe('DynamoDB Error');
        });
    });

    describe('POST /items', () => {
        it('should return 400 when body is missing', async () => {
            const event = {
                requestContext: { http: { method: 'POST' } },
                body: null,
            } as any;

            const result = (await handler(event)) as any;

            expect(result.statusCode).toBe(400);
            expect(JSON.parse(result.body).error).toBe('Missing body');
        });

        it('should save an item to DynamoDB', async () => {
            ddbMock.on(PutCommand).resolves({});

            const itemData = { id: '123', name: 'New Item', price: 99.99 };
            const event = {
                requestContext: { http: { method: 'POST' } },
                body: JSON.stringify(itemData),
            } as any;

            const result = (await handler(event)) as any;

            expect(result.statusCode).toBe(201);
            expect(result.headers?.['Content-Type']).toBe('application/json');
            expect(JSON.parse(result.body).message).toBe('Item saved successfully');
        });

        it('should handle invalid JSON body', async () => {
            const event = {
                requestContext: { http: { method: 'POST' } },
                body: 'invalid json',
            } as any;

            const result = (await handler(event)) as any;

            expect(result.statusCode).toBe(500);
            expect(JSON.parse(result.body)).toHaveProperty('error');
        });

        it('should handle DynamoDB write errors', async () => {
            ddbMock.on(PutCommand).rejects(new Error('Write failed'));

            const event = {
                requestContext: { http: { method: 'POST' } },
                body: JSON.stringify({ id: '123', name: 'Item' }),
            } as any;

            const result = (await handler(event)) as any;

            expect(result.statusCode).toBe(500);
            expect(JSON.parse(result.body).error).toBe('Write failed');
        });
    });

    describe('Unsupported Methods', () => {
        it('should return 405 for DELETE method', async () => {
            const event = {
                requestContext: { http: { method: 'DELETE' } },
                pathParameters: { id: '123' },
            } as any;

            const result = (await handler(event)) as any;

            expect(result.statusCode).toBe(405);
            expect(JSON.parse(result.body).error).toBe('Method Not Allowed');
        });

        it('should return 405 for PUT method', async () => {
            const event = {
                requestContext: { http: { method: 'PUT' } },
                body: JSON.stringify({}),
            } as any;

            const result = (await handler(event)) as any;

            expect(result.statusCode).toBe(405);
            expect(JSON.parse(result.body).error).toBe('Method Not Allowed');
        });

        it('should return 405 for PATCH method', async () => {
            const event = {
                requestContext: { http: { method: 'PATCH' } },
            } as any;

            const result = (await handler(event)) as any;

            expect(result.statusCode).toBe(405);
            expect(JSON.parse(result.body).error).toBe('Method Not Allowed');
        });
    });

    describe('Error Handling', () => {
        it('should catch generic errors and return 500', async () => {
            ddbMock.on(GetCommand).rejects(new Error('Unknown error'));

            const event = {
                requestContext: { http: { method: 'GET' } },
                pathParameters: { id: '123' },
            } as any;

            const result = (await handler(event)) as any;

            expect(result.statusCode).toBe(500);
            const body = JSON.parse(result.body);
            expect(body).toHaveProperty('error');
        });
    });
});
