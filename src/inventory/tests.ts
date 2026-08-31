import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { minimatch } from 'minimatch';
import type { DiscoveredPackage, LayerDefinition, TestRecord } from '../types.js';

export function extractTestTitles(source: string): TestRecord['titles'] {
  const rows: TestRecord['titles'] = [];
  const re =
    /(?:^|[^\w.])(?<kind>test\.describe|describe|test|it)(?:\.(?<mod>skip|only|fixme|fail))?\s*\(\s*(?<q>['"`])(?<title>(?:\\.|[\s\S])*?)\k<q>/g;
  for (const match of source.matchAll(re)) {
    const kind = match.groups?.kind ?? 'test';
    const title = (match.groups?.title ?? '').replace(/\\n/g, ' ').trim();
    if (!title) {
      continue;
    }
    rows.push({
      kind: kind.endsWith('describe') ? 'describe' : 'test',
      title,
    });
  }
  return rows;
}

function expandBraceGlob(pattern: string): string[] {
  const match = pattern.match(/\{([^}]+)\}/);
  if (!match) {
    return [pattern];
  }
  return match[1].split(',').map(part => pattern.replace(match[0], part.trim()));
}

function walkFiles(root: string, max = 8000): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length && out.length < max) {
    const dir = stack.pop();
    if (!dir) {
      break;
    }
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (name === 'node_modules' || name === 'dist' || name === '.git') {
        continue;
      }
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(full);
      } else if (st.isFile()) {
        out.push(full);
      }
    }
  }
  return out;
}

export function inventoryLayer(
  pkg: DiscoveredPackage,
  layer: LayerDefinition,
): TestRecord[] {
  const records: TestRecord[] = [];
  const searchRoots = [pkg.path];
  if (pkg.workspace) {
    searchRoots.push(join(pkg.repoRoot, 'workspaces', pkg.workspace));
  }
  if (layer.id === 'smoke' || layer.id === 'cluster-e2e' || layer.id === 'cluster-free-e2e') {
    searchRoots.push(pkg.repoRoot);
  }
  const seen = new Set<string>();
  const patterns = layer.testGlobs.flatMap(expandBraceGlob);

  for (const root of searchRoots) {
    for (const file of walkFiles(root)) {
      if (seen.has(file)) {
        continue;
      }
      const relRoot = relative(root, file).replaceAll('\\', '/');
      const relRepo = relative(pkg.repoRoot, file).replaceAll('\\', '/');
      const matched = patterns.some(
        pattern =>
          minimatch(relRoot, pattern, { dot: true }) ||
          minimatch(relRepo, pattern, { dot: true }) ||
          minimatch(file.replaceAll('\\', '/'), pattern, { dot: true }),
      );
      if (!matched) {
        continue;
      }
      seen.add(file);
      let source = '';
      try {
        source = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      records.push({
        file: relRepo,
        layerId: layer.id,
        titles: extractTestTitles(source),
      });
    }
  }
  return records;
}

export function findNeighborTemplate(
  sourceRel: string,
  inventory: TestRecord[],
): string | undefined {
  const stem = sourceRel.replace(/\.[^.]+$/, '').split('/').pop();
  if (!stem) {
    return inventory[0]?.file;
  }
  const scored = inventory
    .map(record => {
      const name = record.file.split('/').pop() ?? '';
      let score = 0;
      if (name.includes(stem)) {
        score += 5;
      }
      if (record.file.includes('/__tests__/')) {
        score += 1;
      }
      return { file: record.file, score };
    })
    .sort((a, b) => b.score - a.score);
  return scored[0]?.score ? scored[0].file : inventory[0]?.file;
}
