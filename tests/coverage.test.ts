import { describe, expect, it } from 'vitest';
import { parseIstanbul, parseLcov } from '../src/coverage/parse.js';
import { buildGaps, extractSymbols, extractSnippet } from '../src/coverage/gaps.js';
import type { ChangedFile } from '../src/types.js';

const LCOV = `
SF:/repo/src/utils/format.ts
DA:1,1
DA:2,1
DA:3,0
DA:4,0
DA:5,1
end_of_record
`;

describe('coverage parsers', () => {
  it('parses lcov uncovered lines', () => {
    const report = parseLcov(LCOV, '/repo');
    expect(report.files).toHaveLength(1);
    expect(report.files[0].relPath).toBe('src/utils/format.ts');
    expect(report.files[0].covered).toBe(3);
    expect(report.files[0].uncovered).toBe(2);
    expect(report.files[0].lines[3]).toBe(0);
  });

  it('parses istanbul statementMap', () => {
    const report = parseIstanbul(
      {
        '/repo/src/utils/format.ts': {
          path: '/repo/src/utils/format.ts',
          s: { '0': 1, '1': 0 },
          statementMap: {
            '0': { start: { line: 1 }, end: { line: 1 } },
            '1': { start: { line: 10 }, end: { line: 12 } },
          },
        },
      },
      '/repo',
    );
    expect(report.files[0].lines[1]).toBe(1);
    expect(report.files[0].lines[10]).toBe(0);
    expect(report.files[0].lines[12]).toBe(0);
  });
});

describe('gaps', () => {
  it('intersects changed lines with uncovered lines', () => {
    const report = parseLcov(LCOV, '/repo');
    const changed: ChangedFile[] = [
      {
        path: '/repo/src/utils/format.ts',
        relPath: 'src/utils/format.ts',
        status: 'modified',
        addedLines: [2, 3, 4],
        hunks: [{ start: 2, end: 4 }],
        fileKind: 'unit-logic',
      },
    ];
    const gaps = buildGaps(changed, report);
    expect(gaps[0].uncoveredChangedLines).toEqual([3, 4]);
    expect(gaps[0].coveredChangedLines).toEqual([2]);
  });

  it('treats all changed lines as uncovered when no report exists', () => {
    const changed: ChangedFile[] = [
      {
        path: '/missing.ts',
        relPath: 'missing.ts',
        status: 'added',
        addedLines: [1, 2],
        hunks: [{ start: 1, end: 2 }],
        fileKind: 'unit-logic',
      },
    ];
    const gaps = buildGaps(changed, undefined);
    expect(gaps[0].uncoveredChangedLines).toEqual([1, 2]);
    expect(gaps[0].filePct).toBeNull();
  });

  it('extracts symbols and snippets', () => {
    const source = [
      'export function formatWithMetricUnit(value: string, unit?: string) {',
      '  if (!unit) {',
      '    return value;',
      '  }',
      '  return `${value} ${unit}`;',
      '}',
    ].join('\n');
    expect(extractSymbols(source, [3])).toContain('formatWithMetricUnit');
    expect(extractSnippet(source, [3], 1)).toContain('>   3|');
  });
});
