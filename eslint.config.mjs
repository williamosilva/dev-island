import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'examples/**/node_modules/**', 'coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['warn', { allow: ['error', 'warn'] }],
    },
  },
  {
    files: ['src/renderer/**/*.tsx', 'src/renderer/**/*.ts'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        ResizeObserver: 'readonly',
        HTMLElement: 'readonly',
        HTMLDivElement: 'readonly',
        JSX: 'readonly',
      },
    },
  },
  {
    // Plain Node scripts: the CLI shim, the dev launcher, the example project
    // and the tool configs all run outside the bundlers.
    files: [
      'bin/**/*.js',
      'examples/**/*.js',
      'scripts/**/*.mjs',
      'scripts/**/*.cjs',
      '*.config.ts',
      '*.config.mjs',
    ],
    languageOptions: {
      globals: {
        require: 'readonly',
        module: 'writable',
        exports: 'writable',
        __dirname: 'readonly',
        process: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
    rules: { 'no-console': 'off', '@typescript-eslint/no-require-imports': 'off' },
  },
);
