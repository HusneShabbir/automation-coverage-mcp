import { minimatch } from 'minimatch';

export function matchesAny(relPath: string, patterns: string[] | undefined): boolean {
  if (!patterns?.length) {
    return false;
  }
  const normalized = relPath.replaceAll('\\', '/');
  return patterns.some(pattern =>
    minimatch(normalized, pattern, { dot: true, nocase: false }),
  );
}

export function basename(filePath: string): string {
  return filePath.replaceAll('\\', '/').split('/').pop() ?? filePath;
}

export function dirname(filePath: string): string {
  const normalized = filePath.replaceAll('\\', '/');
  const idx = normalized.lastIndexOf('/');
  return idx <= 0 ? '.' : normalized.slice(0, idx);
}

export function extname(filePath: string): string {
  const name = basename(filePath);
  const idx = name.lastIndexOf('.');
  return idx < 0 ? '' : name.slice(idx);
}

export function stripExt(filePath: string): string {
  return filePath.replace(/\.[^.]+$/, '');
}
