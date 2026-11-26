'use strict';

const { copyFileSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');
const { createSpec } = require('./api-spec.cjs');

for (const environment of ['prod', 'dev']) {
    const output = join(__dirname, '../build/api-docs', environment);
    mkdirSync(output, { recursive: true });
    writeFileSync(join(output, 'openapi.json'), JSON.stringify(createSpec(environment), null, 2) + '\n');
    copyFileSync(join(__dirname, 'api-docs-handler.cjs'), join(output, 'index.cjs'));
    execFileSync(process.execPath, [
        require.resolve('@redocly/cli/bin/cli.js'),
        'lint', join(output, 'openapi.json'),
    ], { stdio: 'inherit' });
    execFileSync(process.execPath, [
        require.resolve('@redocly/cli/bin/cli.js'),
        'build-docs', join(output, 'openapi.json'),
        '--output', join(output, 'index.html'),
        '--title', 'Blockbuster Theatre API',
        '--inlineBundle',
    ], { stdio: 'inherit' });

    // Lambda's synchronous response limit applies to the JSON proxy envelope, not just the HTML.
    const html = readFileSync(join(output, 'index.html'), 'utf8');
    const proxyBytes = Buffer.byteLength(JSON.stringify({ statusCode: 200, headers: {}, body: html }));
    if (proxyBytes > 5_500_000) throw new Error(`API reference response is too large: ${proxyBytes} bytes.`);
}
