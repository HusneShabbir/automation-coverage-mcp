import { describe, expect, it } from 'vitest';
import { BUILTIN_LAYERS } from '../src/layers/builtins.js';
import { cheapestWins, matchingLayers, mergeLayers } from '../src/layers/registry.js';
import type { ChangedFile, LayerDefinition } from '../src/types.js';

function file(relPath: string, kind: ChangedFile['fileKind']): ChangedFile {
  return {
    path: `/repo/${relPath}`,
    relPath,
    status: 'modified',
    addedLines: [10],
    hunks: [{ start: 10, end: 10 }],
    fileKind: kind,
  };
}

describe('layer matching', () => {
  it('sends utils to unit only', () => {
    const matches = cheapestWins(
      matchingLayers(
        BUILTIN_LAYERS,
        file('workspaces/scorecard/plugins/scorecard/src/utils/format.ts', 'unit-logic'),
      ),
      'unit-logic',
    );
    expect(matches.map(m => m.layer.id)).toEqual(['unit']);
  });

  it('sends react components to component, not Playwright', () => {
    const matches = cheapestWins(
      matchingLayers(
        BUILTIN_LAYERS,
        file(
          'workspaces/scorecard/plugins/scorecard/src/components/StatusIcon.tsx',
          'react-component',
        ),
      ),
      'react-component',
    );
    expect(matches.map(m => m.layer.id)).toEqual(['component']);
    expect(matches[0].layer.playwrightMcp).toBe(false);
  });

  it('adds Playwright UI on top of component tests for pages', () => {
    const matches = cheapestWins(
      matchingLayers(
        BUILTIN_LAYERS,
        file(
          'workspaces/scorecard/plugins/scorecard/src/components/ScorecardPage.tsx',
          'react-page',
        ),
        {
          id: 'p',
          name: 'scorecard',
          path: '/repo/workspaces/scorecard/plugins/scorecard',
          relPath: 'workspaces/scorecard/plugins/scorecard',
          repoKey: 'plugins',
          repoKind: 'backstage-workspaces',
          repoRoot: '/repo',
          role: 'frontend-plugin',
          hasPlaywright: true,
        },
      ),
      'react-page',
    );
    expect(matches.map(m => m.layer.id)).toEqual(['component', 'ui']);
    expect(matches[1].layer.playwrightMcp).toBe(true);
  });

  it('pairs unit + integration for backend routers', () => {
    const matches = cheapestWins(
      matchingLayers(
        BUILTIN_LAYERS,
        file(
          'workspaces/scorecard/plugins/scorecard-backend/src/service/router.ts',
          'backend-router',
        ),
      ),
      'backend-router',
    );
    expect(matches.map(m => m.layer.id)).toEqual(['unit', 'integration']);
  });

  it('merges custom YAML layers by id', () => {
    const custom: LayerDefinition = {
      ...BUILTIN_LAYERS[0],
      id: 'contract',
      title: 'OpenAPI contract',
      kind: 'custom',
      ladder: 'custom',
      playwrightMcp: false,
      fileGlobs: ['**/openapi.yaml'],
      testGlobs: ['**/*.contract.test.ts'],
      generator: 'Write a contract test',
    };
    const merged = mergeLayers([custom], ['cluster-e2e']);
    expect(merged.find(l => l.id === 'contract')?.title).toBe('OpenAPI contract');
    expect(merged.find(l => l.id === 'cluster-e2e')).toBeUndefined();
  });
});
