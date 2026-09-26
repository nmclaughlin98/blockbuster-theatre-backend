import {
    intEnv,
    json,
    log,
    mapWithConcurrency,
    normalizeMovieIds,
    projectTmdb,
} from '../../main/lambda/handlers/add-movies-utils';

describe('add movies utilities', () => {
    describe('intEnv', () => {
        const envName = 'ADD_MOVIES_TEST_INTEGER';
        const originalValue = process.env[envName];

        afterEach(() => {
            if (originalValue === undefined) {
                delete process.env[envName];
            } else {
                process.env[envName] = originalValue;
            }
        });

        it('uses the fallback when unset and parses positive integers', () => {
            delete process.env[envName];
            expect(intEnv(envName, 4)).toBe(4);

            process.env[envName] = '12';
            expect(intEnv(envName, 4)).toBe(12);
        });

        it('rejects non-positive and non-integer values', () => {
            process.env[envName] = '0';
            expect(() => intEnv(envName, 4)).toThrow(`Invalid env var ${envName}=0`);

            process.env[envName] = '1.5';
            expect(() => intEnv(envName, 4)).toThrow(`Invalid env var ${envName}=1.5`);
        });
    });

    describe('json', () => {
        it('returns JSON with the expected API headers', () => {
            expect(json(201, { created: true })).toEqual({
                statusCode: 201,
                headers: expect.objectContaining({
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                }),
                body: '{"created":true}',
            });
        });
    });

    describe('log', () => {
        it.each([
            ['INFO', 'log'],
            ['WARN', 'warn'],
            ['ERROR', 'error'],
        ] as const)('writes %s messages to console.%s', (level, method) => {
            const write = jest.spyOn(console, method).mockImplementation(() => undefined);

            log(level, 'test message', { requestId: 'request-1' });

            expect(write).toHaveBeenCalledTimes(1);
            expect(JSON.parse(write.mock.calls[0][0] as string)).toMatchObject({
                level,
                message: 'test message',
                requestId: 'request-1',
            });
        });
    });

    describe('normalizeMovieIds', () => {
        it('trims and deduplicates IDs and reports invalid values', () => {
            expect(normalizeMovieIds([' 123 ', 123, '', 'abc'])).toEqual({
                ids: ['123', 'abc'],
                invalid: ['abc'],
            });
        });
    });

    describe('projectTmdb', () => {
        it('maps TMDB data into the movie record shape', () => {
            const movie = projectTmdb({
                id: 42,
                title: 'A Movie!',
                genres: [{ name: 'Drama' }],
                vote_average: 8.25,
                runtime: 120,
                release_date: '2025-01-02',
                overview: 'A synopsis',
                poster_path: '/poster.jpg',
                backdrop_path: '/backdrop.jpg',
                credits: {
                    cast: [{ name: 'Actor One' }],
                    crew: [{ name: 'Director One', job: 'Director' }],
                },
            });

            expect(movie).toMatchObject({
                slug: 'a-movie',
                movieId: 42,
                title: 'A Movie!',
                genres: ['Drama'],
                genre: 'Drama',
                score: 8.3,
                starring: ['Actor One'],
                director: 'Director One',
                synopsis: 'A synopsis',
                poster: 'https://image.tmdb.org/t/p/w1280/poster.jpg',
                still: 'https://image.tmdb.org/t/p/w1920/backdrop.jpg',
            });
            expect(Object.keys(movie.showtimes)).toHaveLength(7);
        });

        it('supplies defaults when optional TMDB fields are missing', () => {
            expect(projectTmdb({ id: 7, vote_average: 0 })).toMatchObject({
                slug: '',
                movieId: 7,
                title: 'Untitled',
                genres: [],
                genre: 'Uncategorized',
                score: 0,
                runtime: 0,
                releaseDate: '',
                starring: [],
                director: 'Unknown',
                synopsis: '',
                still: '',
                poster: '',
            });
        });
    });

    describe('mapWithConcurrency', () => {
        it('returns mapped results in input order', async () => {
            const results = await mapWithConcurrency([30, 10, 20], 2, async (delay) => {
                await new Promise((resolve) => setTimeout(resolve, delay));
                return delay;
            });

            expect(results).toEqual([30, 10, 20]);
        });

        it('returns an empty result for an empty input', async () => {
            await expect(mapWithConcurrency([], 2, async (value) => value)).resolves.toEqual([]);
        });

        it('propagates worker errors', async () => {
            await expect(
                mapWithConcurrency([1], 1, async () => {
                    throw new Error('worker failed');
                })
            ).rejects.toThrow('worker failed');
        });
    });
});
