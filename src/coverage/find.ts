import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadCoverageFile } from './parse.js';
import type { CoverageReport } from '../types.js';

export const DEFAULT_REPORT_NAMES = [
  'coverage/coverage-final.json',
  'coverage/lcov.info',
  'coverage/cobertura-coverage.xml',
];

export function findCoverageReports(
  searchRoots: string[],
  reportNames: string[] = DEFAULT_REPORT_NAMES,
): Array<{ path: string; report: CoverageReport }> {
  const found: Array<{ path: string; report: CoverageReport }> = [];
  const seen = new Set<string>();
  for (const root of searchRoots) {
    for (const name of reportNames) {
      if (name.endsWith('.xml')) {
        continue;
      }
      const candidate = join(root, name);
      if (existsSync(candidate) && !seen.has(candidate)) {
        seen.add(candidate);
        found.push({ path: candidate, report: loadCoverageFile(candidate, root) });
      }
    }
  }
  return found;
}

export function findCoverageReport(
  searchRoots: string[],
  reportNames: string[] = DEFAULT_REPORT_NAMES,
): { path: string; report: CoverageReport } | undefined {
  return findCoverageReports(searchRoots, reportNames)[0];
}

export function mergeReports(reports: CoverageReport[]): CoverageReport {
  const byRel = new Map<string, CoverageReport['files'][number]>();
  for (const report of reports) {
    for (const file of report.files) {
      const existing = byRel.get(file.relPath);
      if (!existing) {
        byRel.set(file.relPath, {
          ...file,
          lines: { ...file.lines },
        });
        continue;
      }
      for (const [line, hits] of Object.entries(file.lines)) {
        const n = Number(line);
        existing.lines[n] = Math.max(existing.lines[n] ?? 0, hits);
      }
    }
  }
  const files = [...byRel.values()].map(file => {
    const lineNumbers = Object.keys(file.lines).map(Number);
    const covered = lineNumbers.filter(n => file.lines[n] > 0).length;
    const total = lineNumbers.length;
    return {
      ...file,
      covered,
      uncovered: total - covered,
      total,
      pct: total === 0 ? 100 : (covered / total) * 100,
    };
  });
  return { source: 'merged', files };
}
