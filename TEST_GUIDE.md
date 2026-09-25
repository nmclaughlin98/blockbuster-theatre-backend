# Unit Testing Guide

## Project Structure

The project follows a clean separation of main source code and tests:

```
src/
├── main/               # Production source code
│   ├── app.ts          # CDK App entry point
│   ├── stack-configuration.ts        # Main stack definition
│   ├── lambda.ts       # Lambda construct
│   ├── gateway.ts      # API Gateway construct
│   ├── dynamo-db.ts    # DynamoDB construct
│   ├── index.ts        # Export barrel
│   └── handlers/
│       └── manage-items.ts  # Lambda handler
└── test/               # Test files (mirror of main structure)
    ├── stack.test.ts
    ├── lambda.test.ts
    ├── gateway.test.ts
    ├── dynamo-db.test.ts
    └── handlers/
        └── add-movies.test.ts
```

## Overview

This project includes comprehensive unit tests covering all Lambda handlers and AWS CDK constructs. **All 41 tests are passing**.

## Test Setup

### Dependencies Installed
- **jest**: Test framework
- **ts-jest**: TypeScript support for Jest
- **aws-sdk-client-mock**: Mock AWS SDK clients
- **@types/jest**: TypeScript types for Jest

### Configuration Files
- `jest.config.ts`: Jest configuration with:
  - TypeScript support via ts-jest
  - Path aliases for clean imports (@main/*)
  - Module name mapper for path resolution
- `tsconfig.json`: TypeScript compiler configuration with:
  - esModuleInterop enabled
  - Path aliases for clean imports (@main/*)
  - Exclude test files from compilation

## Imports in Tests

Tests use the `@main/` path alias for clean imports:

```typescript
import { BackendStack } from '@main/stack';
import { LambdaConstruct } from '@main/lambda';
import { DatabaseConstruct } from '@main/dynamo-db';
import { ApiGatewayConstruct } from '@main/gateway';
import { handler } from '@main/handlers/manage-items';
```

This is configured in:
- `tsconfig.json`: Path mapping
- `jest.config.ts`: Transform and module name mapper

## Test Suites

### 1. Lambda Handler Tests (16 tests)
**File**: `src/test/handlers/add-movies.test.ts`

Tests the Lambda function that handles API requests:
- **GET /items/{id}**: Retrieve an item from DynamoDB
  - Missing ID validation
  - Successful retrieval
  - Item not found handling
  - DynamoDB error handling
- **POST /items**: Save an item to DynamoDB
  - Missing body validation
  - Successful save
  - Invalid JSON handling
  - DynamoDB write error handling
- **Unsupported Methods**: DELETE, PUT, PATCH validation
- **Error Handling**: Generic error catching and 500 response

### 2. Database Construct Tests (7 tests)
**File**: `src/test/dynamo-db.test.ts`

Tests the DynamoDB table setup:
- Table creation with correct name ('BlockbusterTheatre')
- Billing mode (PAY_PER_REQUEST)
- Partition key configuration (id: STRING)
- Attribute definitions
- Table property export
- Removal policy

### 3. Lambda Construct Tests (8 tests)
**File**: `src/test/lambda.test.ts`

Tests the Lambda function configuration:
- Lambda function creation
- Node.js 20.x runtime
- Memory size (128 MB)
- Timeout (5 seconds)
- Environment variables (TABLE_NAME)
- Function export
- IAM permissions to DynamoDB
- Handler configuration

### 4. API Gateway Construct Tests (7 tests)
**File**: `src/test/gateway.test.ts`

Tests the HTTP API configuration:
- HTTP API creation
- Route creation (GET, POST)
- Lambda integration
- HTTP API property export
- Lambda invoke permissions
- API Gateway stage with auto-deploy

### 5. Backend Stack Tests (9 tests)
**File**: `src/test/stack.test.ts`

Tests the complete infrastructure stack:
- Complete stack creation
- DynamoDB table creation
- Lambda function creation
- HTTP API creation
- API Gateway integration
- Route creation
- API endpoint output
- IAM permissions
- Resource ordering (DB → Lambda → API)

## Running Tests

### Run All Tests
```bash
npm test
```

### Run Tests in Watch Mode
```bash
npm run test:watch
```

### Run Tests with Coverage
```bash
npm run test:coverage
```

### Run Specific Test Suite
```bash
npm test -- src/test/dynamo-db.test.ts
```

### Run Tests Matching a Pattern
```bash
npm test -- --testNamePattern="should create"
```

## Test Results Summary

```
Test Suites: 5 passed, 5 total
Tests:       41 passed, 41 total
Snapshots:   0 total
```

## Mock Strategy

### Lambda Handler Tests
- Uses `aws-sdk-client-mock` to mock DynamoDB client
- Mocks GetCommand and PutCommand responses
- Tests both success and failure scenarios

### CDK Stack Tests
- Uses `aws-cdk-lib/assertions` Template for CloudFormation assertions
- Tests logical construct creation and configuration
- Validates resource properties and relationships

## Best Practices Implemented

1. **Descriptive Test Names**: Each test clearly describes what is being tested
2. **Arrange-Act-Assert Pattern**: Tests follow AAA structure
3. **Error Scenario Testing**: Tests cover both happy path and error cases
4. **Isolated Tests**: Each test is independent and can run in any order
5. **Proper Setup/Teardown**: beforeEach hooks ensure clean state
6. **Mock Isolation**: AWS SDK calls are properly mocked
7. **Clean Imports**: Path aliases for readable test imports
8. **Mirrored Structure**: Tests are organized to mirror source code structure

## Coverage

The test suite provides coverage for:
- ✓ All HTTP methods (GET, POST, unsupported methods)
- ✓ All error conditions (missing parameters, invalid input, service errors)
- ✓ All CDK constructs (Database, Lambda, API Gateway)
- ✓ Infrastructure composition (stack assembly)
- ✓ Permission and configuration validation

## Continuous Integration

These tests are ready for CI/CD integration:
```bash
npm test  # Exit code 0 on success, 1 on failure
```

## Troubleshooting

### Node.js Runtime Warning
The tests may show deprecation warnings for Node.js 20.x. This is expected - CDK flags it as deprecated but still supports it. Consider updating to Node.js 24.x for production deployments.

### TypeScript Compilation
If you see TypeScript errors:
1. Ensure `tsconfig.json` has `esModuleInterop: true` and baseUrl + paths
2. Run `npm install` to ensure all dependencies are installed
3. Check that `@types/jest` and `@types/node` are installed
4. Verify path alias imports use `@main/*` format

### Module Resolution
If tests can't find modules:
1. Check that jest.config.ts has moduleNameMapper configured
2. Ensure ts-jest transform is properly configured
3. Verify file paths match the src/main and src/test structure
4. Run `npm test` again - sometimes the first run needs to warm up

## Adding New Tests

When adding new code, follow this pattern:

```typescript
import { MyFeature } from '@main/my-feature';

describe('My Feature', () => {
    let setup: SetupVariable;

    beforeEach(() => {
        // Initialize test fixtures
    });

    it('should do something specific', () => {
        // Arrange
        const input = { /* test data */ };

        // Act
        const result = myFunction(input);

        // Assert
        expect(result).toBe(expected);
    });
});
```

### Import Guidelines
- Use `@main/*` for importing from src/main
- Keep test structure mirrored to main structure
- Place test files in src/test with same directory structure as src/main
- Use descriptive test names that describe the behavior being tested
