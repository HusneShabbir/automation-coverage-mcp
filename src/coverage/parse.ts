import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import type { CoverageReport, FileCoverage } from '../types.js';

function emptyFile(path: string, relPath: string): FileCoverage {
  return {
    path,
    relPath,
    lines: {},
    covered: 0,
    uncovered: 0,
    total: 0,
    pct: 100,
  };
}

function finalize(file: FileCoverage): FileCoverage {
  const lineNumbers = Object.keys(file.lines).map(Number);
  file.total = lineNumbers.length;
  file.covered = lineNumbers.filter(n => file.lines[n] > 0).length;
  file.uncovered = file.total - file.covered;
  file.pct = file.total === 0 ? 100 : (file.covered / file.total) * 100;
  return file;
}

export function parseLcov(content: string, repoRoot?: string): CoverageReport {
  const files: FileCoverage[] = [];
  let current: FileCoverage | undefined;

  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('SF:')) {
      const path = line.slice(3).trim();
      current = emptyFile(
        path,
        repoRoot ? relative(repoRoot, path).replaceAll('\\', '/') : path,
      );
    } else if (line.startsWith('DA:') && current) {
      const [lineNo, hits] = line.slice(3).split(',');
      current.lines[Number(lineNo)] = Number(hits);
    } else if (line === 'end_of_record' && current) {
      files.push(finalize(current));
      current = undefined;
    }
  }
  if (current) {
    files.push(finalize(current));
  }
  return { source: 'lcov', files };
}

interface IstanbulFile {
  path?: string;
  s?: Record<string, number>;
  statementMap?: Record<
    string,
    { start?: { line?: number }; end?: { line?: number } }
  >;
  l?: Record<string, number>;
}

export function parseIstanbul(
  json: unknown,
  repoRoot?: string,
): CoverageReport {
  const files: FileCoverage[] = [];
  if (!json || typeof json !== 'object') {
    return { source: 'istanbul', files };
  }
  for (const [key, value] of Object.entries(json as Record<string, IstanbulFile>)) {
    const path = value.path ?? key;
    const file = emptyFile(
      path,
      repoRoot ? relative(repoRoot, path).replaceAll('\\', '/') : path,
    );
    if (value.l && typeof value.l === 'object') {
      for (const [line, hits] of Object.entries(value.l)) {
        file.lines[Number(line)] = Number(hits);
      }
    } else if (value.s && value.statementMap) {
      for (const [id, hits] of Object.entries(value.s)) {
        const loc = value.statementMap[id];
        const start = loc?.start?.line;
        const end = loc?.end?.line ?? start;
        if (!start) {
          continue;
        }
        for (let n = start; n <= (end ?? start); n += 1) {
          file.lines[n] = Math.max(file.lines[n] ?? 0, Number(hits));
        }
      }
    }
    files.push(finalize(file));
  }
  return { source: 'istanbul', files };
}

export function loadCoverageFile(filePath: string, repoRoot?: string): CoverageReport {
  const raw = readFileSync(filePath, 'utf8');
  if (filePath.endsWith('.json')) {
    return parseIstanbul(JSON.parse(raw), repoRoot);
  }
  return parseLcov(raw, repoRoot);
}
