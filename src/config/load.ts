import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { homedir } from 'node:os';
import { DEFAULT_REPORT_NAMES } from '../coverage/find.js';
import { discoverForest } from '../discovery/layout.js';
import { mergeLayers } from '../layers/registry.js';
import type { AppConfig, ForestRepo, LayerDefinition, RepoKind } from '../types.js';

const DEFAULT_IGNORE = [
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.spec.ts',
  '**/*.spec.tsx',
  '**/src/index.ts',
  '**/src/index.tsx',
  '**/__fixtures__/**',
  '**/__tests__/**',
  '**/__mocks__/**',
  '**/dist/**',
  '**/node_modules/**',
  '**/setupTests.*',
  '**/playwright.config.ts',
  '**/scripts/**',
  '**/docs/**',
  '**/src/translations/**',
  '**/src/plugin.ts',
  '**/src/alpha.ts',
  '**/src/alpha.tsx',
];

export const PLAN_PRINCIPLES = [
  'Cheapest layer that can catch the failure wins — do not duplicate the same assertion downstream.',
  'Justify each test by the failure it would catch, not by a coverage delta. Coverage numbers rank gaps; they are not a merge gate.',
  'Mirror a neighboring test in that repo. Do not invent Backstage test-utils import paths from memory.',
  'UI specs: explore with Playwright MCP first (navigate, snapshot, generate locators, verify), then write the file. Never generate Playwright code from a scenario paragraph alone.',
];

function isRepoKind(value: unknown): value is RepoKind {
  return (
    typeof value === 'string' &&
    [
      'backstage-workspaces',
      'rhdh-monorepo',
      'overlay-workspaces',
      'shared-playwright',
      'backstage-monorepo',
      'generic',
    ].includes(value)
  );
}

function parseForest(raw: unknown): ForestRepo[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map(item => {
      if (!item || typeof item !== 'object') {
        return undefined;
      }
      const rec = item as Record<string, unknown>;
      if (typeof rec.key !== 'string' || typeof rec.path !== 'string') {
        return undefined;
      }
      return {
        key: rec.key,
        path: resolve(rec.path),
        kind: isRepoKind(rec.kind) ? rec.kind : 'generic',
      };
    })
    .filter((r): r is ForestRepo => Boolean(r));
}

function parseYamlLayers(raw: unknown): LayerDefinition[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const layers: LayerDefinition[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const rec = item as Record<string, unknown>;
    if (typeof rec.id !== 'string') {
      continue;
    }
    layers.push({
      id: rec.id,
      title: String(rec.title ?? rec.id),
      description: String(rec.description ?? ''),
      kind: (rec.kind as LayerDefinition['kind']) ?? 'custom',
      ladder: (rec.ladder as LayerDefinition['ladder']) ?? 'custom',
      cost: (rec.cost as LayerDefinition['cost']) ?? 's',
      cluster: Boolean(rec.cluster),
      docker: Boolean(rec.docker),
      playwrightMcp: Boolean(rec.playwrightMcp),
      fileGlobs: Array.isArray(rec.fileGlobs) ? rec.fileGlobs.map(String) : [],
      fileKinds: Array.isArray(rec.fileKinds)
        ? (rec.fileKinds as LayerDefinition['fileKinds'])
        : undefined,
      repoKinds: Array.isArray(rec.repoKinds)
        ? (rec.repoKinds as LayerDefinition['repoKinds'])
        : undefined,
      testGlobs: Array.isArray(rec.testGlobs) ? rec.testGlobs.map(String) : [],
      excludeGlobs: Array.isArray(rec.excludeGlobs)
        ? rec.excludeGlobs.map(String)
        : undefined,
      templateHints: Array.isArray(rec.templateHints)
        ? rec.templateHints.map(String)
        : [],
      locate: {
        neighbor: rec.locate && typeof rec.locate === 'object'
          ? Boolean((rec.locate as { neighbor?: boolean }).neighbor)
          : true,
        directory:
          rec.locate && typeof rec.locate === 'object'
            ? (rec.locate as { directory?: string }).directory
            : undefined,
        naming:
          rec.locate && typeof rec.locate === 'object'
            ? (rec.locate as { naming?: string }).naming
            : undefined,
      },
      runCommand: typeof rec.runCommand === 'string' ? rec.runCommand : undefined,
      generator: String(rec.generator ?? 'Write a test that catches the uncovered failure.'),
    });
  }
  return layers;
}

export function findConfigFile(startDir: string): string | undefined {
  if (process.env.AUTOMATION_COVERAGE_CONFIG) {
    return process.env.AUTOMATION_COVERAGE_CONFIG;
  }
  let dir = resolve(startDir);
  for (let i = 0; i < 12; i += 1) {
    for (const name of ['.automation-coverage.yaml', 'automation-coverage.yaml']) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  const home = join(homedir(), '.config', 'automation-coverage', 'config.yaml');
  if (existsSync(home)) {
    return home;
  }
  return undefined;
}

export function loadConfig(cwd: string): AppConfig {
  const configPath = findConfigFile(cwd);
  const raw = configPath
    ? (parseYaml(readFileSync(configPath, 'utf8')) as Record<string, unknown>)
    : {};

  const forest = parseForest(raw.forest);
  const coverageRaw = (raw.coverage as Record<string, unknown>) ?? {};
  const targets = (coverageRaw.targets as Record<string, unknown>) ?? {};
  const playwright = (raw.playwrightMcp as Record<string, unknown>) ?? {};
  const yamlLayers = parseYamlLayers(raw.layers);
  const disabled = Array.isArray(raw.disabledLayers)
    ? raw.disabledLayers.map(String)
    : [];

  return {
    forest: discoverForest(cwd, forest),
    coverage: {
      targets: {
        default: Number(targets.default ?? 80),
        patch: Number(targets.patch ?? 80),
      },
      reportNames: Array.isArray(coverageRaw.reportNames)
        ? coverageRaw.reportNames.map(String)
        : DEFAULT_REPORT_NAMES,
      ignore: Array.isArray(coverageRaw.ignore)
        ? coverageRaw.ignore.map(String)
        : DEFAULT_IGNORE,
    },
    playwrightMcp: {
      enabled: playwright.enabled !== false,
      serverName: String(playwright.serverName ?? 'playwright'),
      testingCaps: playwright.testingCaps !== false,
    },
    layers: mergeLayers(yamlLayers, disabled),
    disabledLayers: disabled,
  };
}
