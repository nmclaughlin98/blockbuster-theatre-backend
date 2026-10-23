import type { Config } from 'jest';

const config: Config = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/src/test/**/*.test.ts'],

  // Runs setup.ts before every test suite runs
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts'],

  // Coverage is collected by the dedicated npm run test:coverage command.
  coverageReporters: ['text', 'lcov', 'html'],

  // Destination folder for reports
  coverageDirectory: 'coverage',

  collectCoverageFrom: [
    'src/main/**/*.ts',
    'lib/stack/gateway.ts',
    '!**/*.d.ts',
    '!**/node_modules/**',
  ],
  coverageThreshold: {
    global: {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^@main/(.*)$': '<rootDir>/src/main/$1',
  },

  transform: {
    '^.+\\.ts$': [
      '@swc/jest',
      {
        jsc: {
          target: 'es2022',
          parser: {
            syntax: 'typescript',
            decorators: true,
            dynamicImport: true,
          },
          transform: {
            legacyDecorator: true,
            decoratorMetadata: true,
          },
        },
        module: {
          type: 'commonjs',
        },
      },
    ],
  },
};

export default config;