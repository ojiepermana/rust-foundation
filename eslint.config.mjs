// Lint rules for every TypeScript, JavaScript module, and Angular template in the repo.
// Generated roots come from generated-roots.json so they are never linted.
import { readFileSync } from 'node:fs';
import eslint from '@eslint/js';
import angular from 'angular-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

const generatedRoots = JSON.parse(
  readFileSync(new URL('./generated-roots.json', import.meta.url), 'utf8'),
).roots;

const namedExportsOnly = {
  'no-restricted-exports': [
    'error',
    {
      restrictDefaultExports: {
        direct: true,
        named: true,
        defaultFrom: true,
        namedFrom: true,
        namespaceFrom: true,
      },
    },
  ],
};

export default defineConfig([
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    '**/.angular/',
    'target/',
    '.claude/',
    ...generatedRoots.map((root) => `${root}/`),
  ]),
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: namedExportsOnly,
  },
  {
    files: ['apps/web/src/**/*.ts'],
    extends: [angular.configs.tsRecommended],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'app', style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'app', style: 'kebab-case' },
      ],
    },
  },
  {
    files: ['apps/web/src/**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
  },
  {
    files: ['**/*.mjs'],
    extends: [eslint.configs.recommended],
    languageOptions: {
      sourceType: 'module',
      globals: { process: 'readonly', console: 'readonly', URL: 'readonly' },
    },
  },
]);
