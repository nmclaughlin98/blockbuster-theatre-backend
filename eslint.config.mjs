import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
    {
        ignores: ['cdk-out/**', 'dist/**', 'coverage/**', 'node_modules/**', '**/*.js', '**/*.d.ts'],
    },

    eslint.configs.recommended,
    ...tseslint.configs.recommended,

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
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
            ],
            '@typescript-eslint/no-explicit-any': 'warn',

            // Enforce your exact blank line & spacing preferences
            '@stylistic/padding-line-between-statements': [
                'error',
                // 1. Always require a blank line before 'return'
                { blankLine: 'always', prev: '*', next: 'return' },

                // 2. Require a blank line after multi-line const/let declarations (like your scanTable call)
                { blankLine: 'always', prev: 'multiline-const', next: '*' },
                { blankLine: 'always', prev: 'multiline-let', next: '*' },

                // 3. Require a blank line after multi-line expressions (like your log('ERROR', { ... }) calls)
                { blankLine: 'always', prev: 'multiline-expression', next: '*' },

                // 4. Require a blank line before and after block statements (if, try/catch, for)
                { blankLine: 'always', prev: '*', next: ['if', 'try', 'for', 'while'] },
                { blankLine: 'always', prev: ['if', 'try', 'for', 'while'], next: '*' },
            ],

            // Limit consecutive blank lines to 1 and forbid trailing spaces
            '@stylistic/no-multiple-empty-lines': ['error', { max: 1, maxEOF: 0 }],
            '@stylistic/no-trailing-spaces': 'error',
        },
    },

    // Must come last to disable ESLint rules that conflict with Prettier line wrapping
    eslintConfigPrettier,
);
