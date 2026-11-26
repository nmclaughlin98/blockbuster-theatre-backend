'use strict';

const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const html = readFileSync(join(__dirname, 'index.html'), 'utf8');
const spec = readFileSync(join(__dirname, 'openapi.json'), 'utf8');

exports.handler = async (event) => {
    const path = event.rawPath;
    if (path === '/api-docs') {
        return {
            statusCode: 200,
            headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' },
            body: html,
        };
    }
    if (path === '/api-docs/openapi.json') {
        return {
            statusCode: 200,
            headers: {
                'content-type': 'application/json; charset=utf-8',
                'content-disposition': 'attachment; filename="openapi.json"',
                'cache-control': 'no-cache',
                'x-content-type-options': 'nosniff',
            },
            body: spec,
        };
    }
    return { statusCode: 404, headers: { 'content-type': 'text/plain' }, body: 'Not found' };
};
