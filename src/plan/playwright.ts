import type {
  CoverageGap,
  DiscoveredPackage,
  LayerDefinition,
  WorkItem,
} from '../types.js';

export function buildPlaywrightPrompt(input: {
  item: WorkItem;
  gap: CoverageGap;
  layer: LayerDefinition;
  pkg?: DiscoveredPackage;
  serverName: string;
}): string {
  const { item, gap, layer, pkg, serverName } = input;
  const baseUrl = 'http://localhost:3000';
  const config = pkg?.playwrightConfig
    ? `Playwright config: ${pkg.playwrightConfig}`
    : 'Discover playwright.config.ts in the workspace at runtime.';

  return [
    `You are a Playwright test generator working with the ${serverName} MCP.`,
    'You are filling a coverage gap — the scenario comes from uncovered changed UI, not from a made-up user story.',
    '',
    'DO NOT generate test code based on the scenario alone.',
    `DO run steps one by one using the tools provided by the Playwright MCP (${serverName}).`,
    '',
    '## Target',
    `- Plugin / package: ${item.packageName}`,
    `- Source under test: ${item.sourceFile}`,
    `- Uncovered changed lines: ${item.uncoveredChangedLines.join(', ') || 'unknown (no coverage report)'}`,
    `- Symbols / components: ${item.symbols.join(', ') || '(infer from source window)'}`,
    `- Failure this test must catch: ${item.failureToCatch}`,
    `- Save spec to: ${item.outputPath}`,
    `- Mirror template: ${item.template ?? 'open a neighboring e2e spec in this workspace and copy its bootstrap'}`,
    `- ${config}`,
    pkg?.workspace ? `- Workspace: ${pkg.workspace}` : '',
    '',
    '## Playwright MCP loop',
    '1. Read the workspace playwright.config.ts (port, APP_MODE, testDir, locales).',
    `2. ${serverName}: browser_navigate to ${baseUrl} (or PLAYWRIGHT_URL / config baseURL).`,
    `3. ${serverName}: browser_snapshot — identify the UI for ${item.symbols[0] ?? 'the changed component'}.`,
    `4. Explore the uncovered behavior with browser_click / browser_type / browser_wait_for. For list/catalog pages, drive search, filters, and alternate views. Assert outcomes (which rows remain, URL query params), not a dump of #root ARIA snapshots, nth(), or generated react-aria ids.`,
    `5. ${serverName}: browser_generate_locator for every element you will assert.`,
    `6. ${serverName}: browser_verify_element_visible / browser_verify_text_visible for expected states.`,
    '7. Implement a Playwright TypeScript test using @playwright/test from that message history.',
    '8. Use role-based locators, auto-retrying assertions, no extra timeouts unless necessary.',
    '9. Prefer existing page objects / getTranslations() over hardcoded English.',
    '10. Save the spec, run it, iterate until it passes. Then close the browser.',
    '',
    '## Layer constraint',
    layer.generator,
    '',
    '## Source window (uncovered change)',
    '```',
    gap.snippet || '(source unavailable)',
    '```',
  ]
    .filter(line => line !== '')
    .join('\n');
}
