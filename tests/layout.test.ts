import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverForest, discoverPackages } from '../src/discovery/layout.js';

describe('discoverPackages', () => {
  it('finds plugins nested under workspaces/*/plugins/*', () => {
    const root = mkdtempSync(join(tmpdir(), 'acm-'));
    const plugin = join(root, 'workspaces', 'scorecard', 'plugins', 'scorecard');
    mkdirSync(plugin, { recursive: true });
    writeFileSync(
      join(plugin, 'package.json'),
      JSON.stringify({
        name: '@red-hat-developer-hub/backstage-plugin-scorecard',
        backstage: { role: 'frontend-plugin' },
      }),
    );
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@redhat-developer/rhdh-plugins' }));
    writeFileSync(
      join(root, 'workspaces', 'scorecard', 'playwright.config.ts'),
      'export default {}',
    );

    const forest = [{ key: 'plugins', path: root, kind: 'backstage-workspaces' as const }];
    const packages = discoverPackages(forest);
    expect(packages).toHaveLength(1);
    expect(packages[0].workspace).toBe('scorecard');
    expect(packages[0].role).toBe('frontend-plugin');
    expect(packages[0].hasPlaywright).toBe(true);
  });

  it('detects a redhat_projects-style forest', () => {
    const forestRoot = mkdtempSync(join(tmpdir(), 'rp-'));
    mkdirSync(join(forestRoot, 'rhdh-plugins'));
    mkdirSync(join(forestRoot, 'rhdh'));
    const forest = discoverForest(join(forestRoot, 'rhdh-plugins'));
    expect(forest.map(r => r.key).sort()).toEqual(['plugins', 'rhdh'].sort());
  });
});
