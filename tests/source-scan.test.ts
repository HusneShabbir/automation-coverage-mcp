import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { packagesUnderCwd, scanWorkspaceSource } from '../src/discovery/source-scan.js';
import type { DiscoveredPackage } from '../src/types.js';

function pkg(path: string, workspace: string, id: string): DiscoveredPackage {
  return {
    id,
    name: id,
    path,
    relPath: id,
    repoKey: 'plugins',
    repoKind: 'backstage-workspaces',
    repoRoot: path.split('/workspaces/')[0] ?? path,
    workspace,
    role: 'frontend-plugin',
    hasPlaywright: false,
  };
}

describe('packagesUnderCwd', () => {
  it('keeps packages under the cwd and same-named overlay workspace', () => {
    const boost = pkg('/forest/rhdh-plugins/workspaces/boost/plugins/boost', 'boost', 'plugins:boost');
    const scorecard = pkg(
      '/forest/rhdh-plugins/workspaces/scorecard/plugins/scorecard',
      'scorecard',
      'plugins:scorecard',
    );
    const overlay = {
      ...pkg('/forest/overlays/workspaces/boost/e2e-tests', 'boost', 'overlay:boost'),
      repoKind: 'overlay-workspaces' as const,
    };
    const scoped = packagesUnderCwd(
      [boost, scorecard, overlay],
      '/forest/rhdh-plugins/workspaces/boost',
    );
    expect(scoped.map(p => p.id).sort()).toEqual(['overlay:boost', 'plugins:boost']);
  });
});

describe('scanWorkspaceSource', () => {
  it('emits uncovered source files and keeps backend plugin.ts despite ignore', () => {
    const root = mkdtempSync(join(tmpdir(), 'acm-scan-'));
    const plugin = join(root, 'workspaces', 'boost', 'plugins', 'boost-backend');
    mkdirSync(join(plugin, 'src'), { recursive: true });
    writeFileSync(join(plugin, 'src', 'plugin.ts'), 'export const boostPlugin = {};\n');
    writeFileSync(join(plugin, 'src', 'util.ts'), 'export const add = (a: number, b: number) => a + b;\n');

    const backend = pkg(plugin, 'boost', 'plugins:boost-backend');
    backend.repoRoot = root;
    backend.role = 'backend-plugin';

    const files = scanWorkspaceSource({
      packages: [backend],
      repoRoot: root,
      ignore: ['**/src/plugin.ts'],
    });
    expect(files.map(f => f.relPath).sort()).toEqual([
      'workspaces/boost/plugins/boost-backend/src/plugin.ts',
      'workspaces/boost/plugins/boost-backend/src/util.ts',
    ]);
    expect(files.find(f => f.relPath.endsWith('plugin.ts'))?.fileKind).toBe('backend-plugin');
  });

  it('skips app/backend workspace packages', () => {
    const root = mkdtempSync(join(tmpdir(), 'acm-app-'));
    const app = join(root, 'workspaces', 'boost', 'packages', 'app');
    mkdirSync(join(app, 'src'), { recursive: true });
    writeFileSync(join(app, 'src', 'SignIn.tsx'), 'export const SignIn = () => null;\n');
    const appPkg = pkg(app, 'boost', 'plugins:app');
    appPkg.repoRoot = root;
    appPkg.role = 'frontend';
    const files = scanWorkspaceSource({
      packages: [appPkg],
      repoRoot: root,
      ignore: [],
    });
    expect(files).toHaveLength(0);
  });
});
