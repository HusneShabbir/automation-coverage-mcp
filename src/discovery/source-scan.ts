import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { classifyFile, isSourceKind } from './classify.js';
import { matchesAny } from '../globs.js';
import { coverageForFile, uncoveredLines } from '../coverage/gaps.js';
import type {
  ChangedFile,
  CoverageReport,
  DiscoveredPackage,
} from '../types.js';

const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git']);

function walkSource(root: string, max = 4000): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length && out.length < max) {
    const dir = stack.pop();
    if (!dir) {
      break;
    }
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (SKIP_DIRS.has(name)) {
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
      } else if (st.isFile() && /\.(ts|tsx)$/.test(name)) {
        out.push(full);
      }
    }
  }
  return out;
}

function executableLines(absPath: string): number[] {
  let text = '';
  try {
    text = readFileSync(absPath, 'utf8');
  } catch {
    return [1];
  }
  const lines: number[] = [];
  text.split(/\r?\n/).forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      return;
    }
    lines.push(idx + 1);
  });
  return lines.length ? lines : [1];
}

function inferWorkspace(cwd: string): string | undefined {
  const match = cwd.replaceAll('\\', '/').match(/\/workspaces\/([^/]+)/);
  return match?.[1];
}

export function packagesUnderCwd(
  packages: DiscoveredPackage[],
  cwd: string,
  workspace?: string,
): DiscoveredPackage[] {
  const root = resolve(cwd);
  const inferred = workspace ?? inferWorkspace(root);
  const local = packages.filter(
    pkg => pkg.path === root || pkg.path.startsWith(`${root}/`),
  );
  const sameWorkspace = inferred
    ? packages.filter(pkg => pkg.workspace === inferred)
    : [];
  const byId = new Map<string, DiscoveredPackage>();
  for (const pkg of [...local, ...sameWorkspace]) {
    byId.set(pkg.id, pkg);
  }
  return [...byId.values()];
}

export function scanWorkspaceSource(options: {
  packages: DiscoveredPackage[];
  repoRoot: string;
  ignore: string[];
  coverage?: CoverageReport;
}): ChangedFile[] {
  const files: ChangedFile[] = [];
  for (const pkg of options.packages) {
    if (pkg.role === 'frontend' || pkg.role === 'backend') {
      continue;
    }
    const srcRoot = join(pkg.path, 'src');
    const walkRoot = statSyncSafeDir(srcRoot) ? srcRoot : pkg.path;
    for (const abs of walkSource(walkRoot)) {
      const relPath = relative(options.repoRoot, abs).replaceAll('\\', '/');
      const fileKind = classifyFile(relPath);
      const fileName = relPath.split('/').pop() ?? '';
      if (fileName === 'index.ts' || fileName === 'index.tsx') {
        continue;
      }
      if (!isSourceKind(fileKind)) {
        continue;
      }
      if (
        matchesAny(relPath, options.ignore) &&
        fileKind !== 'backend-plugin' &&
        fileKind !== 'backend-router'
      ) {
        continue;
      }
      const coverage = coverageForFile(options.coverage, relPath);
      const uncovered = coverage
        ? uncoveredLines(coverage)
        : executableLines(abs);
      if (uncovered.length === 0) {
        continue;
      }
      files.push({
        path: abs,
        relPath,
        status: 'modified',
        addedLines: uncovered,
        hunks: uncovered.length
          ? [{ start: uncovered[0], end: uncovered[uncovered.length - 1] }]
          : [],
        fileKind,
        packageId: pkg.id,
      });
    }
  }
  return files;
}

function statSyncSafeDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
