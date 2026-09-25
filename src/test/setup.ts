import * as path from 'path';
import * as fs from 'fs';

// Point output to <project-root>/bin/cdk-out with a subfolder per worker
const targetDir = path.resolve(
    __dirname,
    '../../bin/cdk-out',
    `test-worker-${process.env.JEST_WORKER_ID || '1'}`
);

// Ensure the directory exists
fs.mkdirSync(targetDir, { recursive: true });

// Assign the unique output directory to the CDK environment variable
process.env.CDK_OUTDIR = targetDir;