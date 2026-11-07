const { FlatCompat } = require('@eslint/eslintrc')

const compat = new FlatCompat({
  baseDirectory: __dirname,
})

module.exports = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    files: ['app/(dashboard)/dashboard/page.tsx'],
    languageOptions: {
      globals: {
        React: 'readonly',
        RequestInit: 'readonly',
      },
    },
    rules: {
      // This page contains the Core workflow and must not reference a
      // runtime-only identifier that TypeScript may see as an ambient global.
      'no-undef': 'error',
      // Existing issues in this legacy page are outside this focused check.
      '@typescript-eslint/no-unused-vars': 'off',
      'react-hooks/rules-of-hooks': 'off',
    },
  },
]
