import { matchesAny } from '../globs.js';
import type {
  ChangedFile,
  DiscoveredPackage,
  FileKind,
  LayerDefinition,
} from '../types.js';
import { BUILTIN_LAYERS } from './builtins.js';

export interface LayerMatch {
  layer: LayerDefinition;
  score: number;
  reasons: string[];
}

export function mergeLayers(
  extras: LayerDefinition[],
  disabled: string[],
): LayerDefinition[] {
  const byId = new Map<string, LayerDefinition>();
  for (const layer of BUILTIN_LAYERS) {
    byId.set(layer.id, layer);
  }
  for (const layer of extras) {
    const existing = byId.get(layer.id);
    byId.set(layer.id, existing ? { ...existing, ...layer } : layer);
  }
  return [...byId.values()].filter(layer => !disabled.includes(layer.id));
}

export function layerMatchesFile(
  layer: LayerDefinition,
  file: ChangedFile,
  pkg?: DiscoveredPackage,
): LayerMatch | undefined {
  if (layer.repoKinds?.length && pkg && !layer.repoKinds.includes(pkg.repoKind)) {
    return undefined;
  }
  if (matchesAny(file.relPath, layer.excludeGlobs)) {
    return undefined;
  }

  const reasons: string[] = [];
  let score = 0;

  if (layer.fileKinds?.includes(file.fileKind)) {
    score += 3;
    reasons.push(`file kind ${file.fileKind}`);
  }
  if (matchesAny(file.relPath, layer.fileGlobs)) {
    score += 2;
    reasons.push('path glob');
  }
  if (layer.playwrightMcp && pkg?.hasPlaywright && layer.kind === 'ui') {
    score += 1;
    reasons.push('workspace has Playwright');
  }
  if (score === 0) {
    return undefined;
  }
  return { layer, score, reasons };
}

export function matchingLayers(
  layers: LayerDefinition[],
  file: ChangedFile,
  pkg?: DiscoveredPackage,
): LayerMatch[] {
  return layers
    .map(layer => layerMatchesFile(layer, file, pkg))
    .filter((m): m is LayerMatch => Boolean(m))
    .sort((a, b) => b.score - a.score);
}

const COST_RANK: Record<string, number> = {
  ms: 0,
  s: 1,
  min: 2,
  cluster: 3,
};

export function cheapestWins(
  matches: LayerMatch[],
  fileKind?: FileKind,
): LayerMatch[] {
  if (matches.length === 0) {
    return [];
  }
  const sorted = [...matches].sort(
    (a, b) => COST_RANK[a.layer.cost] - COST_RANK[b.layer.cost],
  );
  const winner = sorted[0];
  const kept: LayerMatch[] = [winner];
  for (const candidate of sorted.slice(1)) {
    if (
      candidate.layer.playwrightMcp &&
      !winner.layer.playwrightMcp &&
      fileKind === 'react-page'
    ) {
      kept.push(candidate);
    } else if (
      winner.layer.kind === 'unit' &&
      candidate.layer.kind === 'integration' &&
      (fileKind === 'backend-router' || fileKind === 'backend-plugin')
    ) {
      kept.push(candidate);
    }
  }
  return kept;
}
