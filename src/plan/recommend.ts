import { basename, dirname, join } from 'node:path';
import { matchesAny } from '../globs.js';
import type {
  CoverageGap,
  DiscoveredPackage,
  LayerDefinition,
  TestPlan,
  WorkItem,
} from '../types.js';
import { PLAN_PRINCIPLES } from '../config/load.js';
import { findNeighborTemplate, inventoryLayer } from '../inventory/tests.js';
import { cheapestWins, matchingLayers } from '../layers/registry.js';
import { isSourceKind } from '../discovery/classify.js';
import { buildPlaywrightPrompt } from './playwright.js';
import { buildLayerBrief } from './briefs.js';

const DEFAULT_MAX_PER_LAYER: Record<string, number> = {
  unit: 8,
  integration: 2,
  component: 6,
  ui: 2,
  smoke: 1,
  'overlay-e2e': 1,
  'cluster-free-e2e': 1,
  'cluster-e2e': 1,
};

function isBackendHttpKind(kind: CoverageGap['file']['fileKind']): boolean {
  return kind === 'backend-plugin' || kind === 'backend-router';
}

function alreadyHasNeighborTest(sourceRel: string, inventory: { file: string }[]): boolean {
  const stem = basename(sourceRel).replace(/\.[^.]+$/, '');
  return inventory.some(record => {
    const name = record.file.split('/').pop() ?? '';
    return name.includes(stem) && (name.includes('.test.') || name.includes('.spec.') || name.includes('.e2e.'));
  });
}

function gapRank(gap: CoverageGap, pkg: DiscoveredPackage | undefined, hasNeighbor: boolean): number {
  let rank = 0;
  if (!hasNeighbor) {
    rank += 20;
  }
  if (gap.file.fileKind === 'react-page' || gap.file.fileKind === 'backend-plugin') {
    rank += 10;
  }
  if (pkg?.role === 'frontend-plugin' || pkg?.role === 'backend-plugin') {
    rank += 5;
  }
  if (gap.filePct !== null) {
    rank += (100 - gap.filePct) / 10;
  }
  return rank;
}

function locateOutput(
  layer: LayerDefinition,
  sourceRel: string,
  pkg: DiscoveredPackage,
): string {
  const fileName = basename(sourceRel);
  const stem = fileName.replace(/\.[^.]+$/, '');
  const naming = (layer.locate.naming ?? '{basename}.test.ts')
    .replace('{basename}', stem)
    .replace('{plugin}', pkg.name.split('/').pop() ?? pkg.name)
    .replace('{feature}', stem)
    .replace('{workspace}', pkg.workspace ?? '');

  if (layer.locate.neighbor) {
    return join(dirname(sourceRel), naming).replaceAll('\\', '/');
  }
  const directory = layer.locate.directory ?? 'e2e-tests';
  if (pkg.workspace && directory.startsWith('e2e-tests')) {
    return `workspaces/${pkg.workspace}/${directory}/${naming}`.replaceAll(
      '\\',
      '/',
    );
  }
  return `${directory}/${naming}`.replaceAll('\\', '/');
}

function failureToCatch(gap: CoverageGap, layer: LayerDefinition): string {
  const symbols = gap.symbols.length ? gap.symbols.join(', ') : basename(gap.file.relPath);
  const lines =
    gap.uncoveredChangedLines.length > 0
      ? `uncovered changed lines ${gap.uncoveredChangedLines.slice(0, 12).join(', ')}`
      : `changed lines with no coverage report (${gap.file.addedLines.length} added)`;
  return `${layer.title} should fail if ${symbols} regresses (${lines}).`;
}

export function recommendPlan(input: {
  repoRoot: string;
  gaps: CoverageGap[];
  packages: DiscoveredPackage[];
  layers: LayerDefinition[];
  ignore: string[];
  playwrightServerName: string;
  coverageSource?: string;
  patchTarget: number;
  mode?: 'diff' | 'workspace';
}): TestPlan {
  const workItems: WorkItem[] = [];
  const skipped: TestPlan['skipped'] = [];
  const inventoryCache = new Map<string, ReturnType<typeof inventoryLayer>>();
  const workspaceMode = input.mode === 'workspace';

  const getInventory = (pkg: DiscoveredPackage, layer: LayerDefinition) => {
    const key = `${pkg.id}:${layer.id}`;
    if (!inventoryCache.has(key)) {
      inventoryCache.set(key, inventoryLayer(pkg, layer));
    }
    return inventoryCache.get(key)!;
  };

  const rankedGaps = [...input.gaps].sort((a, b) => {
    const pkgA = input.packages.find(p => p.id === a.file.packageId);
    const pkgB = input.packages.find(p => p.id === b.file.packageId);
    return gapRank(b, pkgB, false) - gapRank(a, pkgA, false);
  });

  for (const gap of rankedGaps) {
    const ignored = matchesAny(gap.file.relPath, input.ignore);
    if ((ignored && !isBackendHttpKind(gap.file.fileKind)) || !isSourceKind(gap.file.fileKind)) {
      skipped.push({
        file: gap.file.relPath,
        reason: `ignored or non-source kind (${gap.file.fileKind})`,
      });
      continue;
    }
    if (gap.uncoveredChangedLines.length === 0 && gap.file.addedLines.length > 0) {
      skipped.push({
        file: gap.file.relPath,
        reason: 'changed lines already covered',
      });
      continue;
    }

    const pkg = input.packages.find(p => p.id === gap.file.packageId);
    const matches = cheapestWins(
      matchingLayers(input.layers, gap.file, pkg),
      gap.file.fileKind,
    );
    if (matches.length === 0) {
      skipped.push({ file: gap.file.relPath, reason: 'no matching test layer' });
      continue;
    }

    for (const match of matches) {
      const layer = match.layer;
      const inventory = pkg ? getInventory(pkg, layer) : [];
      if (workspaceMode && alreadyHasNeighborTest(gap.file.relPath, inventory)) {
        skipped.push({
          file: gap.file.relPath,
          reason: `already has ${layer.id} neighbor test`,
        });
        continue;
      }
      const template = findNeighborTemplate(gap.file.relPath, inventory);
      const outputPath = pkg
        ? locateOutput(layer, gap.file.relPath, pkg)
        : gap.file.relPath.replace(/\.[^.]+$/, '.test.ts');
      const item: WorkItem = {
        id: `${layer.id}:${gap.file.relPath}`,
        layerId: layer.id,
        layerTitle: layer.title,
        ladder: layer.ladder,
        cost: layer.cost,
        playwrightMcp: layer.playwrightMcp,
        packageId: pkg?.id ?? 'unknown',
        packageName: pkg?.name ?? 'unknown',
        packagePath: pkg?.path ?? input.repoRoot,
        sourceFile: gap.file.relPath,
        uncoveredChangedLines: gap.uncoveredChangedLines,
        filePct: gap.filePct,
        failureToCatch: failureToCatch(gap, layer),
        symbols: gap.symbols,
        template,
        outputPath,
        runCommand: layer.runCommand,
        reasons: match.reasons,
        brief: '',
      };
      item.brief = buildLayerBrief(item, gap, layer, input.patchTarget);
      if (layer.playwrightMcp) {
        item.playwrightPrompt = buildPlaywrightPrompt({
          item,
          gap,
          layer,
          pkg,
          serverName: input.playwrightServerName,
        });
      }
      workItems.push(item);
    }
  }

  const capped: WorkItem[] = [];
  const perLayer = new Map<string, number>();
  for (const item of workItems) {
    const max = workspaceMode ? (DEFAULT_MAX_PER_LAYER[item.layerId] ?? 3) : Number.POSITIVE_INFINITY;
    const count = perLayer.get(item.layerId) ?? 0;
    if (count >= max) {
      skipped.push({
        file: item.sourceFile,
        reason: `workspace mode cap (${max}) for layer ${item.layerId}`,
      });
      continue;
    }
    perLayer.set(item.layerId, count + 1);
    capped.push(item);
  }

  const ui = capped.filter(i => i.playwrightMcp).length;
  const unitish = capped.length - ui;
  const summary = `Planned ${capped.length} automation item(s) across ${
    new Set(capped.map(i => i.layerId)).size
  } layer(s) (${unitish} non-UI, ${ui} Playwright MCP). ${skipped.length} file(s) skipped.`;

  return {
    repoRoot: input.repoRoot,
    summary,
    principles: PLAN_PRINCIPLES,
    coverageSource: input.coverageSource,
    mode: input.mode,
    workItems: capped,
    skipped,
  };
}
