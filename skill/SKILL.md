---
name: automation-coverage
description: >-
  Coverage-driven test generation for RHDH plugin forests using the
  automation-coverage MCP plus Playwright MCP for UI. Analyzes git changes,
  reads Istanbul/LCOV coverage, and generates the cheapest appropriate
  automation layer (unit, integration, component, plugin Playwright, overlay
  smoke/e2e, cluster-free, cluster). Use when asked to generate tests, fill
  coverage gaps, add unit/integration/e2e automation, raise patch coverage,
  or pair Playwright MCP with coverage data.
---

# Automation Coverage

Use the **automation-coverage** MCP as the planner and **playwright** MCP as the browser for UI layers. Do not write Playwright from a scenario paragraph.

## Steps

1. If no `coverage/coverage-final.json` or `coverage/lcov.info` exists in the workspace, run that workspace's coverage script (`yarn test:all` or `yarn test --coverage --watchAll=false`) when it is cheap enough. If you cannot run it, still plan — changed lines are treated as uncovered.
2. Call `list_layers` and `discover_packages` with `cwd` set to the plugin workspace (`workspaces/<plugin-workspace>`, e.g. `workspaces/boost`) and `workspace` when you need to hide sibling workspaces.
3. Call `analyze_changes` then `coverage_gaps`. If the branch is in sync with origin/main (empty file list), call `generate_test_plan` with `mode=workspace` so the planner scans `src` instead of git diff.
4. Call `generate_test_plan`. That JSON is the source of truth. Prefer the **latest** automation-coverage MCP (workspace mode + scoped coverage). If the live MCP still returns 0 work items on a clean branch, it is stale — reload MCP or run `npx tsx` against `src/pipeline.ts`.
5. Implement every work item where `playwrightMcp` is false:
   - Open `template` in full. If missing, glob the package for a sibling `*.test.ts(x)` and copy its imports.
   - Write the test at `outputPath` so it would catch `failureToCatch`.
   - Run `runCommand`.
6. For work items where `playwrightMcp` is true, call `generate_playwright_brief` and execute each brief with Playwright MCP only:
   - `browser_navigate` → `browser_snapshot` → interact → `browser_generate_locator` → `browser_verify_element_visible` / `browser_verify_text_visible`
   - Then write `@playwright/test` TypeScript mirroring the named template (page objects, `getTranslations()`, `APP_MODE`).
   - Run the spec; iterate until it passes; close the browser.
7. Do not duplicate the same assertion at a more expensive layer. Do not add a test whose only rationale is a coverage percentage.

## Layers (cheapest wins)

| Change | Layer |
| --- | --- |
| Utils, hooks, API clients | `unit` |
| Backend router / plugin wiring | `unit` + `integration` |
| React component | `component` (RTL) |
| React page / user flow | `component` + `ui` (Playwright MCP) |
| Overlay artifact metadata | `smoke` |
| Live stack / real tokens | `overlay-e2e` |
| Plugin loads in real RHDH app | `cluster-free-e2e` |
| Helm / operator / IdP | `cluster-e2e` |

Custom layers come from `.automation-coverage.yaml`.
