import { maintainRollingSchedule } from '../../dist/utils/movie-schedule-service.js';

function parseTargetEnv() {
    const envArg =
        process.argv.find((arg) => arg.startsWith('--env='))?.split('=')[1] ??
        process.env.TARGET_ENV?.trim();
    if (envArg === 'dev' || envArg === 'prod') return envArg;
    throw new Error('Specify --env=dev or --env=prod (or set TARGET_ENV).');
}

async function main() {
    const env = parseTargetEnv();

    process.env.AWS_REGION ||= 'eu-west-2';
    process.env.TABLE_NAME = `blockbuster-theatre-${env}-movie-catalogue`;
    process.env.SHOWTIME_REGISTRY_TABLE_NAME = `blockbuster-theatre-${env}-showtime-registry`;
    process.env.BOOKINGS_TABLE_NAME = `blockbuster-theatre-${env}-bookings-by-showtime`;

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
