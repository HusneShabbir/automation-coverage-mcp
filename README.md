# Automation Coverage MCP

Coverage-driven test generation for the RHDH plugin forest. This MCP analyzes git changes, reads Istanbul/LCOV numbers, and tells agents **which tests to write at which layer**. UI work is handed to [Playwright MCP](https://github.com/microsoft/playwright-mcp) as explore-then-write briefs — this server does not drive a browser.

Plugins live at multiple levels (`workspaces/<ws>/plugins/<plugin>`, backend modules, overlay e2e, RHDH product e2e). Discovery walks that layout instead of hardcoding package names.

## What it does

1. **Discover** packages across `rhdh-plugins`, `community-plugins`, `rhdh`, `rhdh-plugin-export-overlays`, and shared Playwright helper repos.
2. **Analyze** the current git diff (branch vs `origin/main` plus uncommitted work) and classify each file (util, React page, backend router, overlay metadata, platform, …). When the branch is clean, pass `mode=workspace` to scan `src` instead.
3. **Read coverage** (`coverage/coverage-final.json` or `lcov.info`) from the **cwd / scoped packages only** (never a sibling workspace) and intersect uncovered lines with the diff.
4. **Recommend layers** using the cheapest-layer-wins ladder (unit → integration → component → plugin Playwright → overlay/cluster). Layers are pluggable YAML.
5. **Emit briefs** agents can execute. UI briefs are Playwright MCP prompts: navigate, snapshot, generate locators, verify, then write the spec.

Coverage ranks gaps. It is not a merge gate. Each brief states the **failure the test must catch**.

## Pair with Playwright MCP

Add both servers to Cursor MCP config (`~/.cursor/mcp.json`, or `.cursor/mcp.json` in this clone). Playwright needs the testing capability so `browser_generate_locator` and `browser_verify_*` are available.

Substitute **`<ABS_PATH_TO_THIS_CLONE>`** with the absolute path of this repository on your machine (the directory that contains `src/index.ts`).

```json
{
  "mcpServers": {
    "automation-coverage": {
      "command": "npx",
      "args": ["tsx", "<ABS_PATH_TO_THIS_CLONE>/src/index.ts"]
    },
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest", "--caps=testing"]
    }
  }
}
```

If the Cursor workspace *is* this repository, you can use the relative entry already in `.cursor/mcp.json` (`./src/index.ts`) instead of an absolute path.

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
| `generate_test_plan` | Full ordered plan with briefs. `mode=workspace` fills layers on a clean branch |
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

1. `AUTOMATION_COVERAGE_CONFIG` (absolute path to a YAML file)
2. `.automation-coverage.yaml` walking up from `cwd`
3. `~/.config/automation-coverage/config.yaml`
4. Auto-detect: walk up from `cwd` until a parent directory contains sibling clones named `rhdh-plugins`, `community-plugins`, `rhdh`, `rhdh-plugin-export-overlays`, `lightspeed-playwright-e2e`, and/or `backstage`

Forest paths in YAML expand `~` and `${ENV_VAR}`. Copy `config/rhdh-forest.example.yaml` and substitute **`${FOREST_ROOT}`** (or export it) — that value is the parent directory that *contains* your clones, not `rhdh-plugins` itself.

| Token | Replace with |
| --- | --- |
| `${FOREST_ROOT}` | Absolute path of the folder that contains `rhdh-plugins`, `rhdh`, overlays, … |
| `<ABS_PATH_TO_THIS_CLONE>` | Absolute path of this `automation-coverage-mcp` checkout |
| `<plugin-workspace>` | Workspace folder name under `workspaces/` (e.g. `boost`) |

Omit forest entries you have not cloned. If `${FOREST_ROOT}` is left unexpanded, those rows are ignored and auto-detect is used.

## Run

```bash
cd <ABS_PATH_TO_THIS_CLONE>
npm install
npm test
npm start   # stdio MCP
```

Produce a coverage report in the plugin workspace before planning (`yarn test:all` / `backstage-cli repo test --coverage`). If no report is present, changed lines are treated as uncovered.

## Agent workflow

1. `generate_test_plan` with `cwd` set to the plugin workspace. Use `mode=workspace` when git diff is empty (existing plugin, not a feature branch).
2. Implement every `playwrightMcp: false` item by mirroring `template`
3. For `playwrightMcp: true` items, run `generate_playwright_brief` and drive Playwright MCP
4. Skip files in `skipped` (ignored wiring, already covered, non-source, already has a neighbor test)
