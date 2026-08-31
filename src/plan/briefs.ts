import type { CoverageGap, LayerDefinition, WorkItem } from '../types.js';

export function buildLayerBrief(
  item: WorkItem,
  gap: CoverageGap,
  layer: LayerDefinition,
  patchTarget: number,
): string {
  const pct =
    item.filePct === null ? 'no coverage report' : `${item.filePct.toFixed(1)}% lines`;
  const lines =
    item.uncoveredChangedLines.length > 0
      ? item.uncoveredChangedLines.join(', ')
      : '(all added lines — no coverage file found; treat as uncovered)';

  return [
    `# ${layer.title} brief`,
    '',
    `Package: ${item.packageName} (${item.packageId})`,
    `Source: ${item.sourceFile}`,
    `File coverage: ${pct} (informational target ${patchTarget}% — not a merge gate)`,
    `Uncovered changed lines: ${lines}`,
    `Symbols: ${item.symbols.join(', ') || '(none extracted)'}`,
    `Failure to catch: ${item.failureToCatch}`,
    `Output: ${item.outputPath}`,
    `Template to mirror: ${item.template ?? '(none found — glob the package for a sibling test and copy its imports)'}`,
    item.runCommand ? `Run: ${item.runCommand}` : '',
    '',
    '## Rules',
    `- ${layer.generator}`,
    '- Open the template in full before writing. Copy imports, setup, and teardown; replace the subject.',
    '- Do not write a test whose only rationale is moving a coverage percentage.',
    '',
    '## Source window',
    '```',
    gap.snippet || '(source unavailable)',
    '```',
  ]
    .filter(line => line !== '')
    .join('\n');
}
