import { execSync } from 'node:child_process';

const formatOutputMessage = (message) => `\n${message}\n`;

try {
    execSync('tsc', { stdio: 'inherit' });
    console.log(formatOutputMessage('✅ Build successful'));
} catch {
    console.error(formatOutputMessage('❌ Build failed'));
    process.exit(1);
}
