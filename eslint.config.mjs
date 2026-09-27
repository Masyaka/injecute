import js from '@eslint/js';
import vitest from '@vitest/eslint-plugin';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'lib/**',
      'docs/dist/**',
      'docs/.vitepress/cache/**',
      'docs/.vitepress/dist/**',
      'coverage/**',
      'handoffs/**',
      'tests/types/fixtures/**',
      'tests/fixtures/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Type-level code in this library relies on `any` in generic constraints.
      '@typescript-eslint/no-explicit-any': 'off',
      // `{}` is the idiomatic "no services yet" service map.
      '@typescript-eslint/no-empty-object-type': 'off',
      // Walking the parent chain starts from `this`.
      '@typescript-eslint/no-this-alias': [
        'error',
        { allowedNames: ['current', 'level'] },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],
    },
  },
  {
    files: ['scripts/**/*.mjs', 'tests/**/*.mjs', '*.config.*'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', URL: 'readonly' },
    },
  },
  {
    files: ['tests/**/*.ts', '**/*.test.ts', '**/*.test-d.ts'],
    plugins: { vitest },
    rules: {
      ...vitest.configs.recommended.rules,
      // Catches `expect(x).toBe` without a call and other no-op assertions.
      'vitest/valid-expect': 'error',
      'vitest/expect-expect': [
        'error',
        { assertFunctionNames: ['expect', 'expectCode', 'expectTypeOf'] },
      ],
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },
);
