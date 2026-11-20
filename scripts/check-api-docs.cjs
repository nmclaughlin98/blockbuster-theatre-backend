'use strict';

const { readFileSync } = require('node:fs');
const { isDeepStrictEqual } = require('node:util');
const { join } = require('node:path');
const { createSpec } = require('./api-spec.cjs');

const templatePath = process.argv[2];
const environment = process.env.DOCS_ENV || 'prod';
if (!templatePath) throw new Error('Provide the synthesized CloudFormation template path.');
const template = JSON.parse(readFileSync(templatePath, 'utf8'));
const spec = createSpec(environment);
const packagedSpec = JSON.parse(readFileSync(join(__dirname, '../build/api-docs', environment, 'openapi.json'), 'utf8'));
if (!isDeepStrictEqual(packagedSpec, spec)) {
    throw new Error('Generated OpenAPI does not match the current contract and environment; rebuild the documentation.');
}
const expected = new Map();
for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
        expected.set(`${method.toUpperCase()} ${path}`, operation.security.length ? 'JWT' : 'NONE');
    }
}
const docsRoutes = new Set(['GET /api-docs', 'GET /api-docs/openapi.json']);
const actual = new Map();
for (const resource of Object.values(template.Resources || {})) {
    if (resource.Type !== 'AWS::ApiGatewayV2::Route') continue;
    const { RouteKey, AuthorizationType } = resource.Properties;
    if (docsRoutes.has(RouteKey)) {
        if (AuthorizationType !== 'NONE') throw new Error(`Documentation route is not public: ${RouteKey}`);
        docsRoutes.delete(RouteKey);
    } else {
        if (actual.has(RouteKey)) throw new Error(`Duplicate API route: ${RouteKey}`);
        actual.set(RouteKey, AuthorizationType || 'NONE');
    }
}
if (docsRoutes.size) throw new Error(`Missing documentation routes: ${[...docsRoutes].join(', ')}`);
for (const [route, authorization] of expected) {
    if (actual.get(route) !== authorization) {
        throw new Error(`Route ${route}: expected ${authorization}, got ${actual.get(route) || 'missing'}`);
    }
    actual.delete(route);
}
if (actual.size) throw new Error(`Undocumented routes: ${[...actual.keys()].join(', ')}`);
console.log(`Verified ${expected.size} documented routes and authorization types.`);
