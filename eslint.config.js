import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    files: ['src/**/*.ts', 'scripts/**/*.ts', 'test/**/*.ts', 'backend/src/**/*.ts'],
    rules: {
      // Relax noisy rules that fire on legitimate existing patterns.
      // These are tracked issues to address in a separate workstream.
      '@typescript-eslint/no-explicit-any': 'off', // backend uses `any` for D1/Hono generics
      '@typescript-eslint/no-unused-vars': 'off', // tsconfig noUnusedLocals covers src/; tests excluded
      'no-unused-vars': 'off', // superseded by TS
      'no-useless-escape': 'off', // false positives on intentional regex escapes (backend/src)
      '@typescript-eslint/no-empty-object-type': 'off' // AgoraPlugin marker interface in src/types.ts
    }
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'hub/**', 'backend/dist/**', 'backend/node_modules/**']
  }
);
