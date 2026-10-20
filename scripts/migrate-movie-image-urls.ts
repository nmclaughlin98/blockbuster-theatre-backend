import {
    DynamoDBDocumentClient,
    ScanCommand,
    UpdateCommand,
    type NativeAttributeValue,
} from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from '../src/main/lambda/handlers/dynamodb-client';
import { originalTmdbImageUrl } from '../src/main/lambda/handlers/utils/movie-projection';

type ImageField = 'poster' | 'still';

interface MigrationReport {
    recordsScanned: number;
    recordsChanged: number;
}

function requiredEnvironmentValue(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name} must be set.`);
    return value;
}

export async function migrateMovieImageUrls(
    client: DynamoDBDocumentClient,
    tableName: string,
    apply: boolean,
    reportChange: (tmdbId: string, fields: ImageField[]) => void = (
        tmdbId,
        fields
    ) => console.log(
        `${apply ? 'Updating' : 'Would update'} movie ${tmdbId}: ${fields.join(', ')}`
    )
): Promise<MigrationReport> {
    let exclusiveStartKey: Record<string, NativeAttributeValue> | undefined;
    let recordsScanned = 0;
    let recordsChanged = 0;

    do {
        const page = await client.send(
            new ScanCommand({
                TableName: tableName,
                ProjectionExpression: '#tmdbId, #slug, #poster, #still',
                ExpressionAttributeNames: {
                    '#tmdbId': 'tmdbId',
                    '#slug': 'slug',
                    '#poster': 'poster',
                    '#still': 'still',
                },
                ExclusiveStartKey: exclusiveStartKey,
            })
        );

        for (const item of page.Items ?? []) {
            recordsScanned++;
            if (typeof item.tmdbId !== 'string' || typeof item.slug !== 'string') {
                throw new Error('The movie table contains a record without valid key attributes.');
            }

            const changes: Partial<Record<ImageField, string>> = {};
            const changedFields: ImageField[] = [];
            for (const field of ['poster', 'still'] as const) {
                const current = item[field];
                if (typeof current !== 'string') continue;

                const updated = originalTmdbImageUrl(current);
                if (updated !== current) {
                    changes[field] = updated;
                    changedFields.push(field);
                }
            }
            if (Object.keys(changes).length === 0) continue;

            recordsChanged++;
            reportChange(item.tmdbId, changedFields);
            if (!apply) {
                continue;
            }

            const expressionAttributeNames: Record<string, string> = {};
            const expressionAttributeValues: Record<string, string> = {};
            const assignments = Object.entries(changes).map(([field, value], index) => {
                const name = `#field${index}`;
                const placeholder = `:value${index}`;
                expressionAttributeNames[name] = field;
                expressionAttributeValues[placeholder] = value;
                return `${name} = ${placeholder}`;
            });

            await client.send(
                new UpdateCommand({
                    TableName: tableName,
                    Key: { tmdbId: item.tmdbId, slug: item.slug },
                    UpdateExpression: `SET ${assignments.join(', ')}`,
                    ExpressionAttributeNames: expressionAttributeNames,
                    ExpressionAttributeValues: expressionAttributeValues,
                })
            );
        }

        exclusiveStartKey = page.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return { recordsScanned, recordsChanged };
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    if (args.some((argument) => argument !== '--apply')) {
        throw new Error('The only supported argument is --apply.');
    }

    const tableName = requiredEnvironmentValue('MOVIE_TABLE_NAME');
    const apply = args.includes('--apply');
    const client = DynamoDBDocumentClient.from(createDynamoDBClient());
    const report = await migrateMovieImageUrls(client, tableName, apply);

    console.log(
        `Scanned ${report.recordsScanned} movie records; ${report.recordsChanged} need URL updates.`
    );
    console.log(apply
        ? 'Updates applied.'
        : 'Dry run only; rerun with --apply to write updates.');
}

if (require.main === module) {
    main().catch((error: unknown) => {
        console.error('Failed to migrate movie image URLs:', error);
        process.exitCode = 1;
    });
}
