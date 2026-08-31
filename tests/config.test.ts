import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/load.js';

const prev = process.env.AUTOMATION_COVERAGE_CONFIG;

afterEach(() => {
  if (prev === undefined) {
    delete process.env.AUTOMATION_COVERAGE_CONFIG;
  } else {
    process.env.AUTOMATION_COVERAGE_CONFIG = prev;
  }
});

describe('loadConfig', () => {
  it('merges a custom YAML layer and disables builtins', () => {
    const dir = mkdtempSync(join(tmpdir(), 'acm-cfg-'));
    const configPath = join(dir, 'automation-coverage.yaml');
    writeFileSync(
      configPath,
      `
disabledLayers: [cluster-e2e]
layers:
  - id: contract
    title: HTTP contract
    kind: custom
    cost: s
    fileGlobs: ["**/router.ts"]
    testGlobs: ["**/*.contract.test.ts"]
    generator: Write a contract test
playwrightMcp:
  serverName: playwright
`,
    );
    process.env.AUTOMATION_COVERAGE_CONFIG = configPath;
    const config = loadConfig(dir);
    expect(config.layers.find(l => l.id === 'contract')?.title).toBe('HTTP contract');
    expect(config.layers.find(l => l.id === 'cluster-e2e')).toBeUndefined();
    expect(config.playwrightMcp.serverName).toBe('playwright');
  });
});
