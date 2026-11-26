import * as fs from 'fs';
import * as path from 'path';

export default async function globalTeardown(): Promise<void> {
    const testWorkersDir = path.resolve(__dirname, '../../cdk-out/test-workers');
    fs.rmSync(testWorkersDir, { recursive: true, force: true });
}
