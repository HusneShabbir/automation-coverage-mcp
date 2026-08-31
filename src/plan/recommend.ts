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
    const dir = dirname(sourceRel);
    if (dir.includes('/src/')) {
      return join(dir, '__tests__', naming).replaceAll('\\', '/');
    }
    return join(dir, naming).replaceAll('\\', '/');
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
}): TestPlan {
  const workItems: WorkItem[] = [];
  const skipped: TestPlan['skipped'] = [];
  const inventoryCache = new Map<string, ReturnType<typeof inventoryLayer>>();

  const getInventory = (pkg: DiscoveredPackage, layer: LayerDefinition) => {
    const key = `${pkg.id}:${layer.id}`;
    if (!inventoryCache.has(key)) {
      inventoryCache.set(key, inventoryLayer(pkg, layer));
    }
    return inventoryCache.get(key)!;
  };

  for (const gap of input.gaps) {
    if (matchesAny(gap.file.relPath, input.ignore) || !isSourceKind(gap.file.fileKind)) {
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

  const ui = workItems.filter(i => i.playwrightMcp).length;
  const unitish = workItems.length - ui;
  const summary = `Planned ${workItems.length} automation item(s) across ${
    new Set(workItems.map(i => i.layerId)).size
  } layer(s) (${unitish} non-UI, ${ui} Playwright MCP). ${skipped.length} file(s) skipped.`;

  return {
    repoRoot: input.repoRoot,
    summary,
    principles: PLAN_PRINCIPLES,
    coverageSource: input.coverageSource,
    workItems,
    skipped,
  };
}
