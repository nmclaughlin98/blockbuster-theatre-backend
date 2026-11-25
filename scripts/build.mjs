import { execSync } from 'node:child_process';

const formatOutputMessage = (message) => `\n${message}\n`;

try {
    execSync('tsc', { stdio: 'inherit' });
    console.log(formatOutputMessage('✅ Build successful'));
} catch {
    console.error(formatOutputGoMessage('❌ Build failed'));
    process.exit(1);
}