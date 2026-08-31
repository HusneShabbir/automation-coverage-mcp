import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { classifyFile } from '../discovery/classify.js';
import type { ChangedFile, DiscoveredPackage } from '../types.js';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 20 * 1024 * 1024,
  });
}

export function gitRoot(cwd: string): string {
  return git(cwd, ['rev-parse', '--show-toplevel']).trim();
}

export function resolveBaseRef(cwd: string, requested?: string): string {
  if (requested) {
    return requested;
  }
  for (const candidate of ['origin/main', 'main', 'origin/master', 'master']) {
    try {
      git(cwd, ['rev-parse', '--verify', candidate]);
      return candidate;
    } catch {
      // try next
    }
  }
  return 'HEAD';
}

export function parseUnifiedDiffAccurate(diff: string, repoRoot: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  let current: ChangedFile | undefined;
  let newLine = 0;
  let inHunk = false;

  const finish = () => {
    if (!current) {
      return;
    }
    current.addedLines = [...new Set(current.addedLines)].sort((a, b) => a - b);
    files.push(current);
    current = undefined;
    inHunk = false;
  };

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('diff --git ')) {
      finish();
      const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      const rel = (match?.[2] ?? match?.[1] ?? '').trim();
      if (!rel) {
        continue;
      }
      current = {
        path: resolve(repoRoot, rel),
        relPath: rel.replaceAll('\\', '/'),
        status: 'modified',
        addedLines: [],
        hunks: [],
        fileKind: classifyFile(rel),
      };
      continue;
    }
    if (!current) {
      continue;
    }
    if (line.startsWith('new file mode')) {
      current.status = 'added';
    } else if (line.startsWith('deleted file mode')) {
      current.status = 'deleted';
    } else if (line.startsWith('@@')) {
      const hunk = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (!hunk) {
        continue;
      }
      newLine = Number(hunk[3]);
      const count = hunk[4] === undefined ? 1 : Number(hunk[4]);
      current.hunks.push({
        start: newLine,
        end: count === 0 ? newLine - 1 : newLine + count - 1,
      });
      inHunk = true;
    } else if (!inHunk) {
      continue;
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      current.addedLines.push(newLine);
      newLine += 1;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      // deleted from old file; new-file cursor unchanged
    } else if (line.startsWith('\\')) {
      // "\ No newline at end of file"
    } else {
      newLine += 1;
    }
  }
  finish();
  return files;
}

function mergeChanged(files: ChangedFile[]): ChangedFile[] {
  const byPath = new Map<string, ChangedFile>();
  for (const file of files) {
    const existing = byPath.get(file.relPath);
    if (!existing) {
      byPath.set(file.relPath, {
        ...file,
        addedLines: [...file.addedLines],
        hunks: [...file.hunks],
      });
      continue;
    }
    existing.status = file.status === 'added' ? 'added' : existing.status;
    existing.addedLines = [...new Set([...existing.addedLines, ...file.addedLines])].sort(
      (a, b) => a - b,
    );
    existing.hunks.push(...file.hunks);
  }
  return [...byPath.values()];
}

export function attachPackages(
  files: ChangedFile[],
  packages: DiscoveredPackage[],
): ChangedFile[] {
  const sorted = [...packages].sort((a, b) => b.path.length - a.path.length);
  return files.map(file => {
    const pkg = sorted.find(p => file.path.startsWith(`${p.path}/`) || file.path === p.path);
    return { ...file, packageId: pkg?.id };
  });
}

export function collectUntracked(repoRoot: string): ChangedFile[] {
  let listing = '';
  try {
    listing = git(repoRoot, ['ls-files', '--others', '--exclude-standard']);
  } catch {
    return [];
  }
  return listing
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .filter(rel => existsSync(join(repoRoot, rel)))
    .map(rel => {
      const abs = resolve(repoRoot, rel);
      return {
        path: abs,
        relPath: relative(repoRoot, abs).replaceAll('\\', '/'),
        status: 'untracked' as const,
        addedLines: [],
        hunks: [],
        fileKind: classifyFile(rel),
      };
    });
}

export function analyzeGitChanges(options: {
  cwd: string;
  base?: string;
  includeUncommitted?: boolean;
  includeUntracked?: boolean;
}): { repoRoot: string; base: string; files: ChangedFile[] } {
  const repoRoot = gitRoot(options.cwd);
  const base = resolveBaseRef(repoRoot, options.base);
  const chunks: string[] = [];
  try {
    chunks.push(git(repoRoot, ['diff', '--unified=0', `${base}...HEAD`]));
  } catch {
    chunks.push(git(repoRoot, ['diff', '--unified=0', base]));
  }
  if (options.includeUncommitted !== false) {
    chunks.push(git(repoRoot, ['diff', '--unified=0', 'HEAD']));
    chunks.push(git(repoRoot, ['diff', '--unified=0', '--cached']));
  }
  const files = mergeChanged(
    chunks.flatMap(chunk => parseUnifiedDiffAccurate(chunk, repoRoot)),
  );
  if (options.includeUntracked) {
    return {
      repoRoot,
      base,
      files: mergeChanged([...files, ...collectUntracked(repoRoot)]),
    };
  }
  return { repoRoot, base, files };
}
