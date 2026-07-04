import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    files: ['src/**/*.ts', 'scripts/**/*.ts', 'test/**/*.ts'],
    rules: {
      // Relax noisy rules that fire on legitimate existing patterns.
      // These are tracked issues to address in a separate workstream.
      '@typescript-eslint/no-explicit-any': 'off',
      'no-useless-escape': 'off', // false positives on intentional regex escapes
      '@typescript-eslint/no-empty-object-type': 'off', // AgoraPlugin marker interface in src/types.ts
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-unused-vars': 'off' // superseded by TS
    }
  },
  {
    // Plain Node.js test fixtures (executable scripts spawned by tests).
    files: ['test/fixtures/**/*.js'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setInterval: 'readonly',
        setTimeout: 'readonly',
        clearInterval: 'readonly',
        clearTimeout: 'readonly'
      }
    }
  },
  {
    ignores: ['dist/**', 'node_modules/**']
  }
);
