import { readFileSync } from 'node:fs';
import type { ChangedFile, CoverageGap, CoverageReport, FileCoverage } from '../types.js';

export function coverageForFile(
  report: CoverageReport | undefined,
  relPath: string,
): FileCoverage | undefined {
  if (!report) {
    return undefined;
  }
  const normalized = relPath.replaceAll('\\', '/');
  return report.files.find(file => {
    const candidate = file.relPath.replaceAll('\\', '/');
    return (
      candidate === normalized ||
      candidate.endsWith(`/${normalized}`) ||
      normalized.endsWith(`/${candidate}`) ||
      candidate.endsWith(normalized.split('/').slice(-3).join('/'))
    );
  });
}

export function uncoveredLines(coverage: FileCoverage | undefined): number[] {
  if (!coverage) {
    return [];
  }
  return Object.entries(coverage.lines)
    .filter(([, hits]) => hits === 0)
    .map(([line]) => Number(line))
    .sort((a, b) => a - b);
}

export function extractSymbols(source: string, focusLines: number[]): string[] {
  const lines = source.split(/\r?\n/);
  const names = new Set<string>();
  const windowStart = Math.max(0, (focusLines[0] ?? 1) - 40);
  const windowEnd = Math.min(lines.length, (focusLines.at(-1) ?? lines.length) + 5);
  const slice = lines.slice(windowStart, windowEnd).join('\n');
  const patterns = [
    /export\s+(?:async\s+)?function\s+([A-Z]?[A-Za-z0-9_]+)/g,
    /export\s+const\s+([A-Z]?[A-Za-z0-9_]+)\s*=/g,
    /export\s+class\s+([A-Za-z0-9_]+)/g,
    /(?:export\s+default\s+)?function\s+([A-Z][A-Za-z0-9_]+)/g,
    /const\s+([A-Z][A-Za-z0-9_]+)\s*[:=]/g,
  ];
  for (const pattern of patterns) {
    for (const match of slice.matchAll(pattern)) {
      names.add(match[1]);
    }
  }
  return [...names];
}

export function extractSnippet(
  source: string,
  focusLines: number[],
  context = 2,
): string {
  if (focusLines.length === 0) {
    return '';
  }
  const lines = source.split(/\r?\n/);
  const start = Math.max(1, Math.min(...focusLines) - context);
  const end = Math.min(lines.length, Math.max(...focusLines) + context);
  return lines
    .slice(start - 1, end)
    .map((text, idx) => {
      const n = start + idx;
      const mark = focusLines.includes(n) ? '>' : ' ';
      return `${mark}${String(n).padStart(4, ' ')}| ${text}`;
    })
    .join('\n');
}

export function readSource(absPath: string): string {
  try {
    return readFileSync(absPath, 'utf8');
  } catch {
    return '';
  }
}

export function buildGaps(
  changed: ChangedFile[],
  report: CoverageReport | undefined,
): CoverageGap[] {
  return changed
    .filter(file => file.status !== 'deleted')
    .map(file => {
      const coverage = coverageForFile(report, file.relPath);
      const uncovered = new Set(uncoveredLines(coverage));
      const uncoveredChanged = file.addedLines.filter(n =>
        coverage ? uncovered.has(n) : true,
      );
      const coveredChanged = file.addedLines.filter(
        n => coverage && !uncovered.has(n) && (coverage.lines[n] ?? 0) > 0,
      );
      const source = readSource(file.path);
      const focus = uncoveredChanged.length ? uncoveredChanged : file.addedLines;
      return {
        file,
        coverage,
        uncoveredChangedLines: uncoveredChanged,
        coveredChangedLines: coveredChanged,
        filePct: coverage ? coverage.pct : null,
        symbols: extractSymbols(source, focus),
        snippet: extractSnippet(source, focus.slice(0, 40)),
      };
    });
}
