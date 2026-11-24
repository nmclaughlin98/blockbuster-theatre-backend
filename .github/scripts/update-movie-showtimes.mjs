import { build } from 'esbuild';
import { writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

function parseTargetEnv() {
    const envArg =
        process.argv.find((arg) => arg.startsWith('--env='))?.split('=')[1] ??
        process.env.TARGET_ENV?.trim();
    if (envArg === 'dev' || envArg === 'prod') return envArg;
    throw new Error('Specify --env=dev or --env=prod (or set TARGET_ENV).');
}

async function loadScheduleService() {
    const entryPoint = path.join(
        REPO_ROOT,
        'src/main/lambda/handlers/utils/movie-schedule-service.ts'
    );
    const result = await build({
        entryPoints: [entryPoint],
        bundle: true,
        platform: 'node',
        format: 'esm',
        target: 'node22',
        write: false,
        external: ['@aws-sdk/*'],
    });

    const tempFile = path.join(__dirname, `.movie-schedule-service.${Date.now()}.mjs`);
    await writeFile(tempFile, result.outputFiles[0].text, 'utf8');
    try {
        return await import(pathToFileURL(tempFile).href);
    } finally {
        await unlink(tempFile).catch(() => {});
    }
}

async function main() {
    const env = parseTargetEnv();

    process.env.AWS_REGION ||= 'eu-west-2';
    process.env.TABLE_NAME = `blockbuster-theatre-${env}-movie-catalogue`;
    process.env.SHOWTIME_REGISTRY_TABLE_NAME = `blockbuster-theatre-${env}-showtime-registry`;
    process.env.BOOKINGS_TABLE_NAME = `blockbuster-theatre-${env}-bookings-by-showtime`;

    const { maintainRollingSchedule } = await loadScheduleService();

    console.log(`Maintaining rolling showtime registry for ${env}...`);
    const summary = await maintainRollingSchedule({ cleanPast: true });

    console.log(
        `✅ Showtime registry updated for ${env}: ${summary.screenings} active screenings across ${summary.datesProcessed} dates (${summary.staleScreeningsRemoved} past screenings cleaned).`
    );
}

main().catch((error) => {
    console.error('Failed to update showtime registry:', error);
    process.exitCode = 1;
});
