import { createHash } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const TIME_SLOTS = ['11:30', '14:15', '17:00', '19:45', '22:15'];

function parseTargetEnv() {
  const envArg =
    process.argv.find((arg) => arg.startsWith('--env='))?.split('=')[1] ??
    process.env.TARGET_ENV?.trim();
  if (envArg === 'dev' || envArg === 'prod') return envArg;
  throw new Error('Specify --env=dev or --env=prod (or set TARGET_ENV).');
}

function generateDeterministicShowtimes(tmdbId, score) {
  const schedule = {};
  const slotsPerDay = score >= 7.5 ? 3 : 2;

  for (const day of DAYS) {
    const hash = createHash('sha256').update(`${tmdbId}:${day}`).digest();
    const chosen = new Set();
    let offset = 0;

    while (chosen.size < slotsPerDay) {
      const time = TIME_SLOTS[hash[offset % hash.length] % TIME_SLOTS.length];
      const screen = String((hash[(offset + 1) % hash.length] % 4) + 1);
      chosen.add(`${screen}|${time}`);
      offset += 2;
    }

    schedule[day] = [...chosen]
      .map((entry) => {
        const [screen, time] = entry.split('|');
        return { screen, time };
      })
      .sort((a, b) => a.time.localeCompare(b.time));
  }

  return schedule;
}

async function main() {
  const env = parseTargetEnv();
  const apply = process.argv.includes('--apply');
  const tableName = `blockbuster-theatre-${env}-movie-catalogue`;

  const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'eu-west-2' });
  const docClient = DynamoDBDocumentClient.from(client);

  let exclusiveStartKey;
  let scanned = 0;
  let updated = 0;

  do {
    const page = await docClient.send(
      new ScanCommand({
        TableName: tableName,
        ProjectionExpression: '#tmdbId, #slug, #title, #score',
        ExpressionAttributeNames: {
          '#tmdbId': 'tmdbId',
          '#slug': 'slug',
          '#title': 'title',
          '#score': 'score',
        },
        ExclusiveStartKey: exclusiveStartKey,
      })
    );

    for (const item of page.Items ?? []) {
      scanned += 1;
      const showtimes = generateDeterministicShowtimes(item.tmdbId, item.score ?? 7.0);
      updated += 1;

      if (!apply) {
        console.log(`Would update ${item.title || item.tmdbId}`);
        continue;
      }

      await docClient.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { tmdbId: item.tmdbId, slug: item.slug },
          UpdateExpression: 'SET #showtimes = :showtimes',
          ConditionExpression: 'attribute_exists(#tmdbId) AND attribute_exists(#slug)',
          ExpressionAttributeNames: {
            '#tmdbId': 'tmdbId',
            '#slug': 'slug',
            '#showtimes': 'showtimes',
          },
          ExpressionAttributeValues: {
            ':showtimes': showtimes,
          },
        })
      );
      console.log(`✓ Updated showtimes for ${item.title || item.tmdbId}`);
    }

    exclusiveStartKey = page.LastEvaluatedKey;
  } while (exclusiveStartKey);

  console.log(`Scanned ${scanned} movies in ${tableName}; ${updated} ${apply ? 'updated' : 'previewed'}.`);
}

main().catch((error) => {
  console.error('Failed to update movie showtimes:', error);
  process.exitCode = 1;
});