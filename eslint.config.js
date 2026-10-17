import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/drizzle/**',
      'apps/scanner-agent/**',
      'apps/web/next-env.d.ts',
      'apps/web/public/sw.js',
      'tests/fixtures/**',
      'playwright-report/**',
      'test-results/**',
      '.dockercfg/**',
      '.data/**',
      '.tools/**',
      'backups/**',
      'diagnostics/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Plain .mjs/.js operator scripts run under Node and use its globals.
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        AbortSignal: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
);
