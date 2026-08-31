# Automation Coverage MCP

Coverage-driven test generation for the RHDH plugin forest. This MCP analyzes git changes, reads Istanbul/LCOV numbers, and tells agents **which tests to write at which layer**. UI work is handed to [Playwright MCP](https://github.com/microsoft/playwright-mcp) as explore-then-write briefs — this server does not drive a browser.

Plugins live at multiple levels (`workspaces/<ws>/plugins/<plugin>`, backend modules, overlay e2e, RHDH product e2e). Discovery walks that layout instead of hardcoding package names.

## What it does

1. **Discover** packages across `rhdh-plugins`, `community-plugins`, `rhdh`, `rhdh-plugin-export-overlays`, and shared Playwright helper repos.
2. **Analyze** the current git diff (branch vs `origin/main` plus uncommitted work) and classify each file (util, React page, backend router, overlay metadata, platform, …).
3. **Read coverage** (`coverage/coverage-final.json` or `lcov.info`) and intersect uncovered lines with the diff.
4. **Recommend layers** using the cheapest-layer-wins ladder (unit → integration → component → plugin Playwright → overlay/cluster). Layers are pluggable YAML.
5. **Emit briefs** agents can execute. UI briefs are Playwright MCP prompts: navigate, snapshot, generate locators, verify, then write the spec.

Coverage ranks gaps. It is not a merge gate. Each brief states the **failure the test must catch**.

## Pair with Playwright MCP

Add both servers to Cursor MCP config. Playwright needs the testing capability so `browser_generate_locator` and `browser_verify_*` are available:

```json
{
  "mcpServers": {
    "automation-coverage": {
      "command": "npx",
      "args": ["tsx", "/Users/hushaik/redhat_projects/automation-coverage-mcp/src/index.ts"]
    },
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest", "--caps=testing"]
    }
  }
}
```

Agent loop for UI gaps:

`generate_playwright_brief` → Playwright `browser_navigate` → `browser_snapshot` → interact → `browser_generate_locator` → `browser_verify_*` → write `@playwright/test` spec mirroring a neighbor → run until green.

Do not write Playwright from the scenario paragraph alone.

## Tools

| Tool | Purpose |
| --- | --- |
| `list_layers` | Builtin + YAML layers |
| `discover_packages` | Plugin packages at every forest level |
| `analyze_changes` | Git diff → package + file kind |
| `get_coverage` | Parse Istanbul/LCOV |
| `coverage_gaps` | Uncovered ∩ changed lines |
| `inventory_tests` | Existing tests (templates to mirror) |
| `recommend_automation` | Cheapest layers + Playwright flag |
| `generate_test_plan` | Full ordered plan with briefs |
| `generate_layer_brief` | One layer (unit / integration / …) |
| `generate_playwright_brief` | Playwright MCP prompt from UI gaps |

Prompts: `fill_automation_gaps`, `playwright_from_coverage`, `unit_from_coverage`.

## Pluggable layers

Builtins (from the RHDH test-placement ladder):

| id | Ladder | Playwright MCP? |
| --- | --- | --- |
| `unit` | L1 Jest/Vitest | no |
| `integration` | L2 `startTestBackend` | no |
| `component` | L3 RTL | no |
| `ui` | Plugin-source Playwright | **yes** |
| `smoke` | Overlay native smoke | no |
| `overlay-e2e` | Overlay cluster Playwright | **yes** |
| `cluster-free-e2e` | RHDH L4a | **yes** |
| `cluster-e2e` | RHDH L4b | **yes** |

Add or override layers in `.automation-coverage.yaml` (see `config/rhdh-forest.example.yaml`):

```yaml
disabledLayers: [cluster-e2e]
layers:
  - id: contract
    title: HTTP contract
    kind: custom
    cost: s
    fileKinds: [backend-router]
    testGlobs: ["**/*.contract.test.ts"]
    generator: Write a contract test against the public HTTP schema.
```

## Config lookup

1. `AUTOMATION_COVERAGE_CONFIG`
2. `.automation-coverage.yaml` walking up from `cwd`
3. `~/.config/automation-coverage/config.yaml`
4. Auto-detect a `redhat_projects` forest (`rhdh-plugins`, `community-plugins`, `rhdh`, overlays, `lightspeed-playwright-e2e`)

## Run

```bash
cd /Users/hushaik/redhat_projects/automation-coverage-mcp
npm install
npm test
npm start   # stdio MCP
```

Produce a coverage report in the plugin workspace before planning (`yarn test:all` / `backstage-cli repo test --coverage`). If no report is present, changed lines are treated as uncovered.

## Agent workflow

1. `generate_test_plan` (or prompt `fill_automation_gaps`)
2. Implement every `playwrightMcp: false` item by mirroring `template`
3. For `playwrightMcp: true` items, run `generate_playwright_brief` and drive Playwright MCP
4. Skip files in `skipped` (ignored wiring, already covered, non-source)
