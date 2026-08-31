import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { recommendPlan } from '../src/plan/recommend.js';
import { BUILTIN_LAYERS } from '../src/layers/builtins.js';
import type { CoverageGap, DiscoveredPackage } from '../src/types.js';

const pkg: DiscoveredPackage = {
  id: 'plugins:workspaces/scorecard/plugins/scorecard',
  name: '@red-hat-developer-hub/backstage-plugin-scorecard',
  path: '/repo/workspaces/scorecard/plugins/scorecard',
  relPath: 'workspaces/scorecard/plugins/scorecard',
  repoKey: 'plugins',
  repoKind: 'backstage-workspaces',
  repoRoot: '/repo',
  workspace: 'scorecard',
  role: 'frontend-plugin',
  hasPlaywright: true,
  playwrightConfig: '/repo/workspaces/scorecard/playwright.config.ts',
};

function gap(relPath: string, kind: CoverageGap['file']['fileKind']): CoverageGap {
  return {
    file: {
      path: `/repo/${relPath}`,
      relPath,
      status: 'modified',
      addedLines: [12, 13],
      hunks: [{ start: 12, end: 13 }],
      fileKind: kind,
      packageId: pkg.id,
    },
    uncoveredChangedLines: [12, 13],
    coveredChangedLines: [],
    filePct: 40,
    symbols: ['ScorecardPage'],
    snippet: '>  12| export const ScorecardPage = () => {',
  };
}

describe('recommendPlan', () => {
  it('skips ignored wiring files', () => {
    const plan = recommendPlan({
      repoRoot: '/repo',
      gaps: [gap('workspaces/scorecard/plugins/scorecard/src/index.ts', 'plugin-wiring')],
      packages: [pkg],
      layers: BUILTIN_LAYERS,
      ignore: ['**/src/index.ts'],
      playwrightServerName: 'playwright',
      patchTarget: 80,
    });
    expect(plan.workItems).toHaveLength(0);
    expect(plan.skipped[0].reason).toMatch(/ignored/);
  });

  it('emits a Playwright prompt for page-level UI gaps', () => {
    const plan = recommendPlan({
      repoRoot: '/repo',
      gaps: [
        gap(
          'workspaces/scorecard/plugins/scorecard/src/components/ScorecardPage/ScorecardPage.tsx',
          'react-page',
        ),
      ],
      packages: [pkg],
      layers: BUILTIN_LAYERS,
      ignore: [],
      playwrightServerName: 'playwright',
      patchTarget: 80,
    });
    const ui = plan.workItems.find(item => item.layerId === 'ui');
    expect(ui?.playwrightMcp).toBe(true);
    expect(ui?.playwrightPrompt).toMatch(/browser_navigate/);
    expect(ui?.playwrightPrompt).toMatch(/DO NOT generate test code based on the scenario alone/);
    expect(ui?.playwrightPrompt).toMatch(/ScorecardPage/);
    expect(plan.workItems.some(item => item.layerId === 'component')).toBe(true);
  });

  it('plans backend plugin.ts even when plugin.ts is in the ignore list', () => {
    const backend: DiscoveredPackage = {
      ...pkg,
      id: 'plugins:workspaces/scorecard/plugins/scorecard-backend',
      name: '@red-hat-developer-hub/backstage-plugin-scorecard-backend',
      path: '/repo/workspaces/scorecard/plugins/scorecard-backend',
      relPath: 'workspaces/scorecard/plugins/scorecard-backend',
      role: 'backend-plugin',
    };
    const plan = recommendPlan({
      repoRoot: '/repo',
      gaps: [
        gap(
          'workspaces/scorecard/plugins/scorecard-backend/src/plugin.ts',
          'backend-plugin',
        ),
      ],
      packages: [backend],
      layers: BUILTIN_LAYERS,
      ignore: ['**/src/plugin.ts'],
      playwrightServerName: 'playwright',
      patchTarget: 80,
      mode: 'workspace',
    });
    expect(plan.workItems.some(item => item.layerId === 'integration')).toBe(true);
  });

  it('skips files that already have a neighbor test in workspace mode', () => {
    const root = mkdtempSync(join(tmpdir(), 'acm-plan-'));
    const plugin = join(root, 'workspaces', 'scorecard', 'plugins', 'scorecard');
    mkdirSync(join(plugin, 'src', 'components', 'ScorecardPage'), { recursive: true });
    writeFileSync(
      join(plugin, 'src', 'components', 'ScorecardPage', 'ScorecardPage.tsx'),
      'export const ScorecardPage = () => null;\n',
    );
    writeFileSync(
      join(plugin, 'src', 'components', 'ScorecardPage', 'ScorecardPage.test.tsx'),
      "describe('ScorecardPage', () => { it('renders', () => {}); });\n",
    );

    const localPkg: DiscoveredPackage = {
      ...pkg,
      path: plugin,
      repoRoot: root,
    };
    const pageGap = gap(
      'workspaces/scorecard/plugins/scorecard/src/components/ScorecardPage/ScorecardPage.tsx',
      'react-page',
    );
    const plan = recommendPlan({
      repoRoot: root,
      gaps: [pageGap],
      packages: [localPkg],
      layers: BUILTIN_LAYERS,
      ignore: [],
      playwrightServerName: 'playwright',
      patchTarget: 80,
      mode: 'workspace',
    });
    expect(plan.workItems.filter(item => item.layerId === 'component')).toHaveLength(0);
    expect(plan.skipped.some(s => s.reason.includes('neighbor test'))).toBe(true);
  });

  it('does not plan UI when changed lines are already covered', () => {
    const covered: CoverageGap = {
      ...gap(
        'workspaces/scorecard/plugins/scorecard/src/utils/formatMetricUnit.ts',
        'unit-logic',
      ),
      uncoveredChangedLines: [],
      coveredChangedLines: [12, 13],
      filePct: 100,
    };
    const plan = recommendPlan({
      repoRoot: '/repo',
      gaps: [covered],
      packages: [pkg],
      layers: BUILTIN_LAYERS,
      ignore: [],
      playwrightServerName: 'playwright',
      patchTarget: 80,
    });
    expect(plan.workItems).toHaveLength(0);
    expect(plan.skipped[0].reason).toMatch(/already covered/);
  });
});
