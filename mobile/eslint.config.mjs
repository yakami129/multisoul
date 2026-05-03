// @ts-check
import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import pluginImport from 'eslint-plugin-import';
import pluginPrettier from 'eslint-plugin-prettier';
import pluginReact from 'eslint-plugin-react';
import pluginReactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const mobileFeatureDomains = ['agents', 'chat', 'inbox', 'settings'];
const crossFeatureImportRules = mobileFeatureDomains.map((domain) => ({
  files: [`**/src/features/${domain}/**/*.{ts,tsx}`],
  rules: {
    'no-restricted-imports': /** @type {import('eslint').Linter.RuleEntry} */ ([
      'error',
      {
        patterns: mobileFeatureDomains
          .filter((otherDomain) => otherDomain !== domain)
          .map((otherDomain) => ({
            group: [`@/features/${otherDomain}/**`],
            message: `Cross-feature imports must use the public feature entry point, for example "@/features/${otherDomain}".`,
          })),
      },
    ]),
  },
}));

export default tseslint.config(
  // ── 忽略目录 ────────────────────────────────────────────────
  {
    ignores: [
      'node_modules/**',
      '.expo/**',
      'dist/**',
      'build/**',
      'coverage/**',
      'babel.config.js',
      'metro.config.js',
      'jest.setup.js',
      'jest.environment.js',
      'tailwind.config.js',
      'jest.mock-expo-winter.js',
    ],
  },

  // ── 基础规则（所有 TS/TSX 文件）────────────────────────────
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,

  {
    plugins: {
      react: pluginReact,
      'react-hooks': pluginReactHooks,
      import: pluginImport,
      prettier: pluginPrettier,
    },
    languageOptions: {
      parserOptions: {
        project: './tsconfig.eslint.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      react: { version: 'detect' },
      'import/resolver': {
        typescript: {
          project: './tsconfig.eslint.json',
        },
      },
    },
    rules: {
      // ── Prettier 格式化（warn，不阻断开发）──────────────────
      'prettier/prettier': 'warn',

      // ── TypeScript：核心安全规则（error）────────────────────
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',

      // ── TypeScript：其他规则（warn）─────────────────────────
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/await-thenable': 'warn',
      '@typescript-eslint/no-misused-promises': 'warn',

      // ── React Hooks：核心规则（error）───────────────────────
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',

      // ── React：其他规则（warn）──────────────────────────────
      'react/jsx-key': 'warn',
      'react/no-unstable-nested-components': 'warn',
      'react/self-closing-comp': 'warn',
      'react/display-name': 'off',

      // ── Import 排序（warn）──────────────────────────────────
      'import/order': [
        'warn',
        {
          groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index']],
          pathGroups: [
            {
              pattern: '@/**',
              group: 'internal',
              position: 'before',
            },
          ],
          pathGroupsExcludedImportTypes: ['builtin'],
          'newlines-between': 'never',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import/no-duplicates': 'warn',

      // ── 通用（warn）─────────────────────────────────────────
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-debugger': 'warn',
    },
  },

  // ── 测试文件：放宽规则 ───────────────────────────────────────
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/__tests__/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // ── Feature 边界：禁止跨 feature 深路径依赖 ────────────────
  ...crossFeatureImportRules,
);
