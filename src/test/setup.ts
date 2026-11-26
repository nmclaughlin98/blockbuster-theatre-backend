import * as path from 'path';
import * as fs from 'fs';

// Point output to <project-root>/bin/cdk-out with a subfolder per worker
const targetDir = path.resolve(
    __dirname,
    '../../cdk-out/test-workers',
    `test-worker-${process.env.JEST_WORKER_ID || '1'}`,
);

// Ensure the directory exists
fs.mkdirSync(targetDir, { recursive: true });

// Assign the unique output directory to the CDK environment variable
process.env.CDK_OUTDIR = targetDir;
process.env.TMDB_API_KEY = 'test-tmdb-key';
process.env.TABLE_NAME = 'test-table';
process.env.MAX_BATCH = '25';
process.env.UPDATE_CONCURRENCY = '2';
delete process.env.CONFIG_BUCKET_NAME;
delete process.env.CONFIG_KEY;
