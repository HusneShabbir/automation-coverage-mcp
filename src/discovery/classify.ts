import type { FileKind } from '../types.js';
import { basename, matchesAny } from '../globs.js';

const TEST_GLOBS = [
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.spec.ts',
  '**/*.spec.tsx',
  '**/__tests__/**',
  '**/__fixtures__/**',
  '**/__mocks__/**',
  '**/setupTests.*',
];

const E2E_GLOBS = [
  '**/e2e-tests/**',
  '**/e2e/**',
  '**/playwright.config.*',
  '**/*.e2e.ts',
  '**/*.e2e.tsx',
];

const DOCS_GLOBS = ['**/docs/**', '**/*.md', '**/README*', '**/LICENSE*'];

const WIRING_NAMES = new Set([
  'plugin.ts',
  'plugin.tsx',
  'index.ts',
  'index.tsx',
  'alpha.ts',
  'alpha.tsx',
  'legacyExports.ts',
  'legacyExports.tsx',
]);

const PAGE_HINTS = [
  'page',
  'router',
  'route',
  'layout',
  'homepage',
  'entitycontent',
  'entitypage',
];

export function classifyFile(relPath: string): FileKind {
  const normalized = relPath.replaceAll('\\', '/');
  const name = basename(normalized).toLowerCase();

  if (matchesAny(normalized, DOCS_GLOBS)) {
    return 'docs';
  }
  if (matchesAny(normalized, E2E_GLOBS)) {
    return 'e2e-test';
  }
  if (matchesAny(normalized, TEST_GLOBS) || name.includes('.integration.test.')) {
    return 'unit-test';
  }
  if (
    matchesAny(normalized, [
      '**/helm/**',
      '**/.tekton/**',
      '**/operator/**',
      '**/deploy/**',
    ])
  ) {
    return 'platform';
  }
  if (
    matchesAny(normalized, [
      '**/metadata/**/*.yaml',
      '**/metadata/**/*.yml',
      '**/dynamic-plugins.yaml',
      '**/dynamic-plugins.default.yaml',
      '**/plugin-manifest.json',
    ])
  ) {
    return 'overlay-metadata';
  }
  if (
    name.startsWith('app-config') ||
    name.endsWith('.yaml') ||
    name.endsWith('.yml')
  ) {
    return 'config';
  }

  const inSrcIndex = normalized.includes('/src/');
  if (inSrcIndex && (WIRING_NAMES.has(basename(normalized)) || /\/src\/(index|plugin|alpha)\./.test(normalized))) {
    if (normalized.includes('-backend') && name.startsWith('plugin.')) {
      return 'backend-plugin';
    }
    return 'plugin-wiring';
  }

  if (normalized.includes('/translations/') || normalized.includes('/generated/')) {
    return 'plugin-wiring';
  }

  if (
    /router\.(ts|tsx)$/.test(name) ||
    normalized.includes('/service/router') ||
    normalized.includes('/middlewares/')
  ) {
    return 'backend-router';
  }

  if (
    normalized.includes('-backend') ||
    normalized.includes('/providers/') ||
    normalized.includes('/database/') ||
    normalized.includes('/scheduler/') ||
    /service\.ts$/.test(name)
  ) {
    if (name.startsWith('plugin.')) {
      return 'backend-plugin';
    }
    return 'backend-service';
  }

  if (normalized.includes('/hooks/') || name.startsWith('use') && name.endsWith('.ts')) {
    return 'frontend-hook';
  }

  if (normalized.includes('/api/') && (name.endsWith('.ts') || name.endsWith('.tsx'))) {
    return 'frontend-api';
  }

  if (name.endsWith('.tsx')) {
    const stem = name.replace(/\.tsx$/, '');
    if (PAGE_HINTS.some(hint => stem.includes(hint)) || normalized.includes('/pages/')) {
      return 'react-page';
    }
    return 'react-component';
  }

  if (name.endsWith('.ts')) {
    return 'unit-logic';
  }

  return 'other';
}

export function isSourceKind(kind: FileKind): boolean {
  return ![
    'docs',
    'e2e-test',
    'unit-test',
    'config',
    'other',
  ].includes(kind);
}
