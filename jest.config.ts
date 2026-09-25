import type { Config } from 'jest';

const config: Config = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/src/test/**/*.test.ts'],

  // Runs setup.ts before every test suite runs
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts'],

  // Automatically collect coverage when running tests
  collectCoverage: true,

  // Specify the format of the output reports
  coverageReporters: ['text', 'lcov', 'html'],

  // Destination folder for reports
  coverageDirectory: 'coverage',

  collectCoverageFrom: [
    'src/main/**/*.ts',
    '!**/*.d.ts',
    '!**/node_modules/**',
  ],
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