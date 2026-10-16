import {
    DynamoDBDocumentClient,
    ScanCommand,
    type NativeAttributeValue,
} from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from './dynamodb-client';

const docClient = DynamoDBDocumentClient.from(createDynamoDBClient());

interface ScanOptions {
    projectionExpression?: string;
    expressionAttributeNames?: Record<string, string>;
}

export async function scanTable(
    tableName: string,
    options: ScanOptions = {}
): Promise<Record<string, NativeAttributeValue>[]> {
    const items: Record<string, NativeAttributeValue>[] = [];
    let exclusiveStartKey: Record<string, NativeAttributeValue> | undefined;

    do {
        const result = await docClient.send(
            new ScanCommand({
                TableName: tableName,
                ProjectionExpression: options.projectionExpression,
                ExpressionAttributeNames: options.expressionAttributeNames,
                ExclusiveStartKey: exclusiveStartKey,
            })
        );
        items.push(...(result.Items ?? []));
        exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return items;
}
