import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';
import eslintConfigPrettier from 'eslint-config-prettier';
import jsonc from 'eslint-plugin-jsonc';
import globals from 'globals';

export default tseslint.config(
    {
        ignores: ['cdk-out/**', 'dist/**', 'coverage/**', 'node_modules/**', '**/*.js', '**/*.d.ts'],
    },

    eslint.configs.recommended,
    ...tseslint.configs.recommended,

    // Must sit before custom stylistic/jsonc rules so Prettier doesn't disable them
    eslintConfigPrettier,

    {
        plugins: {
            '@stylistic': stylistic,
        },
        languageOptions: {
            globals: {
                ...globals.node,
                ...globals.jest,
            },
        },
        rules: {
            '@typescript-eslint/no-unused-vars': ['error',{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' },],
            '@typescript-eslint/no-explicit-any': 'warn',

            // Enforce your exact blank line & spacing preferences
            '@stylistic/padding-line-between-statements': ['error',
                // 1. Always require a blank line before 'return'
                { blankLine: 'always', prev: '*', next: 'return' },

                // 2. Require a blank line after multi-line const/let declarations
                { blankLine: 'always', prev: 'multiline-const', next: '*' },{ blankLine: 'always', prev: 'multiline-let', next: '*' },

                // 3. Require a blank line after multi-line expressions
                { blankLine: 'always', prev: 'multiline-expression', next: '*' },

                // 4. Require a blank line before and after block statements (if, try/catch, for, while)
                { blankLine: 'always', prev: '*', next: ['if', 'try', 'for', 'while'] },{ blankLine: 'always', prev: ['if', 'try', 'for', 'while'], next: '*' },],

            // Limit consecutive blank lines to 1 and forbid trailing spaces
            '@stylistic/no-multiple-empty-lines': ['error', { max: 1, maxEOF: 0 }],
            '@stylistic/no-trailing-spaces': 'error',

            // TypeScript arrays: single-line under 10 items, multi-line at 10+
            '@stylistic/list-style': ['error',{
                    overrides: {
                        ArrayExpression: {
                            multiLine: { minItems: 10 },
                        },
                        ArrayPattern: {
                            multiLine: { minItems: 10 },
                        },
                    },
                },],
        },
    },

    // JSON files: enforce 10-item array rule everywhere EXCEPT seed-data
    ...jsonc.configs['flat/recommended-with-json'],
    {
        files: ['**/*.json'],
        rules: {
            'jsonc/array-bracket-newline': ['error', { minItems: 10 }],
            'jsonc/array-element-newline': ['error', { minItems: 10 }],
        },
    },
    {
        files: ['.github/scripts/seed-data/**/*.json'],
        rules: {
            'jsonc/array-bracket-newline': 'off',
            'jsonc/array-element-newline': 'off',
        },
    },
);
