import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
    BatchWriteCommand,
    DynamoDBDocumentClient,
    PutCommand,
    QueryCommand,
    ScanCommand,
    UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_DIR = path.join(__dirname, 'seed-data');

function parseTargetEnv() {
    const envArg =
        process.argv.find((arg) => arg.startsWith('--env='))?.split('=')[1] ?? process.env.TARGET_ENV;

    if (envArg === 'dev' || envArg === 'prod') return envArg;

    throw new Error('Specify target environment with --env=dev or --env=prod (or TARGET_ENV).');
}

function requiredEnv(name) {
    const value = process.env[name]?.trim();

    if (!value) throw new Error(`${name} environment variable must be set.`);

    return value;
}

function tableNameForEnv(tableSuffix, env) {
    return `blockbuster-theatre-${env.toLowerCase()}-${tableSuffix}`;
}

function slugify(title) {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function randomScreenForShowtime(seed) {
    const digest = createHash('sha256').update(seed).digest();

    return String((digest[0] % 5) + 1);
}

async function readSeedJson(filename, fallback = null) {
    try {
        const raw = await readFile(path.join(SEED_DIR, filename), 'utf8');

        return JSON.parse(raw);
    } catch (error) {
        if (error?.code === 'ENOENT' && fallback !== null) return fallback;

        throw error;
    }
}

function buildTmdbHeaders(apiKey) {
    const token = apiKey.trim();
    const headers = { Accept: 'application/json' };

    if (token.startsWith('eyJ') || token.length > 64) {
        headers.Authorization = `Bearer ${token}`;
    }

    return headers;
}

function appendTmdbAuth(url, apiKey) {
    const token = apiKey.trim();

    if (!(token.startsWith('eyJ') || token.length > 64)) {
        url.searchParams.set('api_key', token);
    }
}

async function fetchTmdbMovie(tmdbId, apiKey) {
    const url = new URL(`https://api.themoviedb.org/3/movie/${encodeURIComponent(tmdbId)}`);
    url.searchParams.set('append_to_response', 'credits,videos,release_dates');
    appendTmdbAuth(url, apiKey);

    const response = await fetch(url, { headers: buildTmdbHeaders(apiKey) });

    if (!response.ok) {
        throw new Error(`TMDB movie lookup failed for ${tmdbId}: HTTP ${response.status}`);
    }

    return response.json();
}

async function fetchTmdbList(listId, apiKey) {
    const fetchPage = async (page) => {
        const url = new URL(`https://api.themoviedb.org/3/list/${encodeURIComponent(listId)}`);
        url.searchParams.set('language', 'en-US');
        url.searchParams.set('page', String(page));
        appendTmdbAuth(url, apiKey);

        const response = await fetch(url, { headers: buildTmdbHeaders(apiKey) });

        if (!response.ok) {
            throw new Error(`TMDB list lookup failed for ${listId} (page ${page}): HTTP ${response.status}`);
        }

        return response.json();
    };

    const firstPage = await fetchPage(1);
    const pages = [firstPage];
    const totalPages = Number(firstPage.total_pages) || 1;

    for (let page = 2; page <= totalPages; page += 1) {
        pages.push(await fetchPage(page));
    }

    const movieIds = [
        ...new Set(
            pages
                .flatMap((p) => (Array.isArray(p.items) ? p.items : []))
                .filter((item) => item && (item.media_type === undefined || item.media_type === 'movie'))
                .map((item) => String(item.id))
                .filter((id) => /^\d+$/.test(id)),
        ),
    ];

    return {
        collectionId: String(firstPage.id ?? listId),
        name: String(firstPage.name || `Collection ${listId}`),
        description: typeof firstPage.description === 'string' ? firstPage.description : '',
        posterUrl:
            typeof firstPage.poster_path === 'string' && firstPage.poster_path
                ? `https://image.tmdb.org/t/p/w500${firstPage.poster_path}`
                : '',
        backdropUrl:
            typeof firstPage.backdrop_path === 'string' && firstPage.backdrop_path
                ? `https://image.tmdb.org/t/p/w1280${firstPage.backdrop_path}`
                : '',
        movieIds,
        isActive: true,
        lastUpdated: new Date().toISOString(),
    };
}

function extractUkCertification(tmdb) {
    const gb = tmdb.release_dates?.results?.find((entry) => entry.iso_3166_1 === 'GB');
    const cert = gb?.release_dates?.find((r) => r.certification?.trim())?.certification?.trim();

    return cert || '12A';
}

function extractTrailerUrl(tmdb) {
    const results = tmdb.videos?.results ?? [];
    const trailer =
        results.find((v) => v.site === 'YouTube' && v.type === 'Trailer') ??
        results.find((v) => v.site === 'YouTube');

    return trailer?.key ? `https://www.youtube.com/embed/${trailer.key}` : '';
}

function mapTmdbToMovieRecord(tmdb) {
    const tmdbId = String(tmdb.id);
    const title = String(tmdb.title || 'Untitled');
    const slug = slugify(title) || `movie-${tmdbId}`;
    const releaseDateRaw =
        typeof tmdb.release_date === 'string' && tmdb.release_date ? tmdb.release_date : '2026-01-01';

    const releaseIso = new Date(`${releaseDateRaw}T00:00:00.000Z`).toISOString();
    const isComingSoon = new Date(`${releaseDateRaw}T00:00:00.000Z`).getTime() > Date.now();
    const genres = Array.isArray(tmdb.genres)
        ? tmdb.genres.map((g) => String(g.name || '')).filter(Boolean)
        : ['Drama'];

    const director = tmdb.credits?.crew?.find((c) => c.job === 'Director')?.name || 'Unknown';
    const starring = (tmdb.credits?.cast ?? [])
        .slice(0, 5)
        .map((c) => String(c.name || ''))
        .filter(Boolean);

    return {
        tmdbId,
        slug,
        title,
        visible: true,
        isComingSoon,
        isCarousel: false,
        genres: genres.length ? genres : ['Drama'],
        mainGenre: genres[0] || 'Drama',
        rating: extractUkCertification(tmdb),
        score: typeof tmdb.vote_average === 'number' ? Number(tmdb.vote_average.toFixed(1)) : 7.0,
        runtime: typeof tmdb.runtime === 'number' && tmdb.runtime > 0 ? tmdb.runtime : 120,
        releaseDate: releaseIso,
        poster:
            typeof tmdb.poster_path === 'string' && tmdb.poster_path
                ? `https://image.tmdb.org/t/p/original${tmdb.poster_path}`
                : '',
        still:
            typeof tmdb.backdrop_path === 'string' && tmdb.backdrop_path
                ? `https://image.tmdb.org/t/p/original${tmdb.backdrop_path}`
                : '',
        starring,
        director,
        synopsis: typeof tmdb.overview === 'string' ? tmdb.overview : '',
        tagline: typeof tmdb.tagline === 'string' ? tmdb.tagline : '',
        trailer: extractTrailerUrl(tmdb),
        startDate: releaseDateRaw,
        preSalesEligible: isComingSoon,
        entityType: 'Movie',
        GSI1PK: 'MOVIE',
        GSI1SK: `${releaseDateRaw}#${tmdbId}`,
    };
}

async function clearTable(docClient, tableName, keyNames) {
    let exclusiveStartKey;
    let deleted = 0;

    do {
        const page = await docClient.send(
            new ScanCommand({
                TableName: tableName,
                ExclusiveStartKey: exclusiveStartKey,
                ConsistentRead: true,
            }),
        );

        const items = page.Items ?? [];

        for (let i = 0; i < items.length; i += 25) {
            const batch = items.slice(i, i + 25).map((item) => {
                const Key = {};

                for (const key of keyNames) Key[key] = item[key];

                return { DeleteRequest: { Key } };
            });

            await docClient.send(new BatchWriteCommand({ RequestItems: { [tableName]: batch } }));
            deleted += batch.length;
        }

        exclusiveStartKey = page.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return deleted;
}

async function updateMovieFlags(docClient, moviesTable, tmdbId, updates) {
    const query = await docClient.send(
        new QueryCommand({
            TableName: moviesTable,
            KeyConditionExpression: 'tmdbId = :tmdbId',
            ExpressionAttributeValues: { ':tmdbId': String(tmdbId) },
            ConsistentRead: true,
        }),
    );

    const record = query.Items?.[0];

    if (!record || typeof record.slug !== 'string') return false;

    const names = {};
    const values = {};
    const sets = Object.entries(updates).map(([field, value], idx) => {
        names[`#f${idx}`] = field;
        values[`:v${idx}`] = value;

        return `#f${idx} = :v${idx}`;
    });

    await docClient.send(
        new UpdateCommand({
            TableName: moviesTable,
            Key: { tmdbId: String(tmdbId), slug: record.slug },
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        }),
    );

    return true;
}

async function main() {
    const env = parseTargetEnv();
    const clearFirst = process.argv.includes('--clear');
    const tmdbApiKey = requiredEnv('TMDB_API_KEY');

    const moviesTable = tableNameForEnv('movie-catalogue', env);
    const collectionsTable = tableNameForEnv('movie-collections', env);
    const pricingTable = tableNameForEnv('ticket-pricing', env);
    const offersTable = tableNameForEnv('booking-offers', env);

    const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'eu-west-2' });
    const docClient = DynamoDBDocumentClient.from(client);

    const [moviesSeed, carouselSeed, hiddenSeed, collectionsSeed, pricingSeed, offersSeed] =
        await Promise.all([
            readSeedJson('movies.json'),
            readSeedJson('carousel.json'),
            readSeedJson('hidden-movies.json'),
            readSeedJson('collections.json', { collectionIds: [] }),
            readSeedJson('pricing.json'),
            readSeedJson('offers.json'),
        ]);

    if (clearFirst) {
        console.log(`Clearing existing seed tables for ${env}...`);
        await clearTable(docClient, moviesTable, ['tmdbId', 'slug']);
        await clearTable(docClient, collectionsTable, ['collectionId']);
        await clearTable(docClient, pricingTable, ['pricingId']);
        await clearTable(docClient, offersTable, ['offerId']);
    }

    // 1. Fetch collections first so any movies referenced by collections are also guaranteed in movie-catalogue
    const collectionIds = (collectionsSeed.collectionIds ?? []).map(String);
    const collections = [];

    if (collectionIds.length > 0) {
        console.log(`Fetching ${collectionIds.length} collections from TMDB...`);

        for (const listId of collectionIds) {
            const collection = await fetchTmdbList(listId, tmdbApiKey);
            collections.push(collection);
            console.log(
                `  ✓ ${collection.name} (${collection.collectionId}) — ${collection.movieIds.length} movies`,
            );
        }
    }

    // 2. Import all movies from TMDB (movies.json + hidden-movies.json + collection movies)
    const allMovieIds = [
        ...new Set([
            ...(moviesSeed.movieIds ?? []).map(String),
            ...(hiddenSeed.movieIds ?? []).map(String),
            ...collections.flatMap((c) => c.movieIds),
        ]),
    ];

    console.log(`Importing ${allMovieIds.length} movies from TMDB into ${moviesTable}...`);

    for (const tmdbId of allMovieIds) {
        const rawTmdb = await fetchTmdbMovie(tmdbId, tmdbApiKey);
        const item = mapTmdbToMovieRecord(rawTmdb);
        await docClient.send(new PutCommand({ TableName: moviesTable, Item: item }));
        console.log(`  ✓ ${item.title} (${tmdbId})`);
    }

    // 3. Apply Carousel flags
    console.log(`Applying carousel flags to ${carouselSeed.movieIds.length} movies...`);

    for (const tmdbId of carouselSeed.movieIds) {
        const updated = await updateMovieFlags(docClient, moviesTable, tmdbId, carouselSeed.updates);

        if (!updated) console.warn(`  ! Carousel movie ${tmdbId} not found in ${moviesTable}`);
    }

    // 4. Apply Hidden movie flags
    console.log(`Hiding ${hiddenSeed.movieIds.length} movies...`);

    for (const tmdbId of hiddenSeed.movieIds) {
        const updated = await updateMovieFlags(docClient, moviesTable, tmdbId, hiddenSeed.updates);

        if (!updated) console.warn(`  ! Hidden movie ${tmdbId} not found in ${moviesTable}`);
    }

    // 5. Seed Collections
    if (collections.length > 0) {
        console.log(`Seeding ${collections.length} collections into ${collectionsTable}...`);

        for (const collection of collections) {
            await docClient.send(new PutCommand({ TableName: collectionsTable, Item: collection }));
        }
    }

    // 6. Seed Pricing
    console.log(`Seeding ${pricingSeed.pricing.length} pricing tiers into ${pricingTable}...`);

    for (const pricing of pricingSeed.pricing) {
        await docClient.send(new PutCommand({ TableName: pricingTable, Item: pricing }));
    }

    // 7. Seed Offers
    console.log(`Seeding ${offersSeed.offers.length} offers into ${offersTable}...`);

    for (const rawOffer of offersSeed.offers) {
        const offer = { ...rawOffer };

        if (offer.overrideShowtimes && typeof offer.overrideShowtimes === 'object') {
            const normalized = {};

            for (const [day, entries] of Object.entries(offer.overrideShowtimes)) {
                normalized[day] = entries.map((entry, index) =>
                    typeof entry === 'string'
                        ? {
                              screen: randomScreenForShowtime(`${offer.offerId}:${day}:${index}:${entry}`),
                              time: entry,
                          }
                        : entry,
                );
            }

            offer.overrideShowtimes = normalized;
        }

        await docClient.send(new PutCommand({ TableName: offersTable, Item: offer }));
    }

    console.log(`✅ Database recreation complete for ${env}!`);
}

main().catch((error) => {
    console.error('Failed to recreate cloud database:', error);
    process.exitCode = 1;
});
