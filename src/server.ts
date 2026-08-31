import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { loadConfig, PLAN_PRINCIPLES } from './config/load.js';
import { findCoverageReport } from './coverage/find.js';
import { loadCoverageFile } from './coverage/parse.js';
import { buildGaps } from './coverage/gaps.js';
import { discoverPackages, packageForPath } from './discovery/layout.js';
import { attachPackages, analyzeGitChanges } from './git/diff.js';
import { inventoryLayer } from './inventory/tests.js';
import { runPipeline } from './pipeline.js';
import { recommendPlan } from './plan/recommend.js';
import type { DiscoveredPackage, TestPlan } from './types.js';

function json(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

function text(value: string) {
  return {
    content: [{ type: 'text' as const, text: value }],
  };
}

export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: 'automation-coverage',
      version: '0.1.0',
    },
    {
      instructions: [
        'Coverage-driven automation planner for RHDH / Backstage plugin forests.',
        'Analyze git changes, read Istanbul/LCOV coverage, and emit pluggable test-layer briefs.',
        'UI layers must be executed with Playwright MCP (explore, then write). Do not generate Playwright from text alone.',
        ...PLAN_PRINCIPLES,
      ].join('\n'),
    },
  );

  server.registerTool(
    'list_layers',
    {
      title: 'List test layers',
      description:
        'List pluggable test layers (unit, integration, component, UI/Playwright, smoke, cluster). Custom YAML layers are merged in.',
      inputSchema: {
        cwd: z.string().optional().describe('Directory used to load automation-coverage.yaml'),
      },
    },
    async ({ cwd }) => {
      const config = loadConfig(cwd ?? process.cwd());
      return json({
        playwrightMcp: config.playwrightMcp,
        disabledLayers: config.disabledLayers,
        layers: config.layers.map(layer => ({
          id: layer.id,
          title: layer.title,
          ladder: layer.ladder,
          kind: layer.kind,
          cost: layer.cost,
          cluster: layer.cluster,
          playwrightMcp: layer.playwrightMcp,
          description: layer.description,
        })),
      });
    },
  );

  server.registerTool(
    'discover_packages',
    {
      title: 'Discover plugin packages',
      description:
        'Discover plugin packages at every level of the RHDH forest (workspaces/*/plugins/*, rhdh plugins, overlay e2e, shared Playwright helpers).',
      inputSchema: {
        cwd: z.string().optional().describe('Starting directory for forest detection'),
      },
    },
    async ({ cwd }) => {
      const config = loadConfig(cwd ?? process.cwd());
      const packages = discoverPackages(config.forest);
      return json({
        forest: config.forest,
        count: packages.length,
        packages: packages.map(summarizePackage),
      });
    },
  );

  server.registerTool(
    'analyze_changes',
    {
      title: 'Analyze git changes',
      description:
        'Parse git diff (branch vs base plus uncommitted) and classify each file into a plugin package and file kind.',
      inputSchema: {
        cwd: z.string().optional(),
        base: z.string().optional().describe('Base ref, default origin/main'),
        includeUncommitted: z.boolean().optional(),
        includeUntracked: z.boolean().optional(),
      },
    },
    async ({ cwd, base, includeUncommitted, includeUntracked }) => {
      const root = cwd ?? process.cwd();
      const config = loadConfig(root);
      const packages = discoverPackages(config.forest);
      const git = analyzeGitChanges({
        cwd: root,
        base,
        includeUncommitted,
        includeUntracked,
      });
      const files = attachPackages(git.files, packages);
      return json({
        repoRoot: git.repoRoot,
        base: git.base,
        files: files.map(file => ({
          relPath: file.relPath,
          status: file.status,
          fileKind: file.fileKind,
          packageId: file.packageId,
          addedLines: file.addedLines,
        })),
      });
    },
  );

  server.registerTool(
    'get_coverage',
    {
      title: 'Get coverage report',
      description:
        'Parse Istanbul JSON or LCOV coverage from a package or workspace. Returns per-file percents and uncovered line numbers.',
      inputSchema: {
        cwd: z.string().optional(),
        reportPath: z
          .string()
          .optional()
          .describe('Explicit coverage-final.json or lcov.info path'),
        packagePath: z.string().optional(),
      },
    },
    async ({ cwd, reportPath, packagePath }) => {
      const root = cwd ?? process.cwd();
      const config = loadConfig(root);
      if (reportPath) {
        const report = loadCoverageFile(reportPath, root);
        return json({
          source: reportPath,
          files: report.files.map(file => ({
            relPath: file.relPath,
            pct: file.pct,
            covered: file.covered,
            uncovered: file.uncovered,
            uncoveredLines: Object.entries(file.lines)
              .filter(([, hits]) => hits === 0)
              .map(([line]) => Number(line)),
          })),
        });
      }
      const found = findCoverageReport(
        [packagePath, root].filter((p): p is string => Boolean(p)),
        config.coverage.reportNames,
      );
      if (!found) {
        return json({
          error: 'No coverage report found. Run yarn test --coverage (or test:all) in the workspace first.',
          searched: config.coverage.reportNames,
        });
      }
      return json({
        source: found.path,
        fileCount: found.report.files.length,
        files: found.report.files.map(file => ({
          relPath: file.relPath,
          pct: Number(file.pct.toFixed(2)),
          covered: file.covered,
          uncovered: file.uncovered,
        })),
      });
    },
  );

  server.registerTool(
    'coverage_gaps',
    {
      title: 'Coverage gaps in changes',
      description:
        'Intersect git-changed lines with uncovered lines from Istanbul/LCOV. Use this before generating tests.',
      inputSchema: {
        cwd: z.string().optional(),
        base: z.string().optional(),
        reportPath: z.string().optional(),
      },
    },
    async ({ cwd, base, reportPath }) => {
      const root = cwd ?? process.cwd();
      const config = loadConfig(root);
      const packages = discoverPackages(config.forest);
      const git = analyzeGitChanges({ cwd: root, base });
      const files = attachPackages(git.files, packages);
      const found = reportPath
        ? { path: reportPath, report: loadCoverageFile(reportPath, git.repoRoot) }
        : findCoverageReport(
            [root, git.repoRoot, ...packages.map(pkg => pkg.path)],
            config.coverage.reportNames,
          );
      const gaps = buildGaps(files, found?.report);
      return json({
        coverageSource: found?.path ?? null,
        gaps: gaps.map(gap => ({
          file: gap.file.relPath,
          fileKind: gap.file.fileKind,
          packageId: gap.file.packageId,
          filePct: gap.filePct,
          uncoveredChangedLines: gap.uncoveredChangedLines,
          coveredChangedLines: gap.coveredChangedLines,
          symbols: gap.symbols,
        })),
      });
    },
  );

  server.registerTool(
    'inventory_tests',
    {
      title: 'Inventory existing tests',
      description:
        'List existing tests for a package at one layer (or all layers). Used to find a template to mirror.',
      inputSchema: {
        cwd: z.string().optional(),
        packageId: z
          .string()
          .optional()
          .describe('Package id from discover_packages, e.g. plugins:workspaces/scorecard/plugins/scorecard'),
        packagePath: z.string().optional(),
        layerId: z.string().optional(),
      },
    },
    async ({ cwd, packageId, packagePath, layerId }) => {
      const root = cwd ?? process.cwd();
      const config = loadConfig(root);
      const packages = discoverPackages(config.forest);
      const pkg = resolvePackage(packages, packageId, packagePath, root);
      if (!pkg) {
        return json({ error: 'Package not found. Call discover_packages first.' });
      }
      const layers = layerId
        ? config.layers.filter(l => l.id === layerId)
        : config.layers;
      const inventory = layers.map(layer => ({
        layerId: layer.id,
        tests: inventoryLayer(pkg, layer),
      }));
      return json({ package: summarizePackage(pkg), inventory });
    },
  );

  server.registerTool(
    'recommend_automation',
    {
      title: 'Recommend test layers',
      description:
        'Given current git changes and coverage numbers, recommend the cheapest test layers and whether Playwright MCP is required.',
      inputSchema: {
        cwd: z.string().optional(),
        base: z.string().optional(),
        reportPath: z.string().optional(),
      },
    },
    async ({ cwd, base, reportPath }) => {
      const pipeline = runPipeline({
        cwd: cwd ?? process.cwd(),
        base,
        coverageRoot: reportPath ? undefined : cwd,
      });
      if (reportPath) {
        const report = loadCoverageFile(reportPath, pipeline.repoRoot);
        const gaps = buildGaps(pipeline.files, report);
        const plan = recommendPlan({
          repoRoot: pipeline.repoRoot,
          gaps,
          packages: pipeline.packages,
          layers: pipeline.config.layers,
          ignore: pipeline.config.coverage.ignore,
          playwrightServerName: pipeline.config.playwrightMcp.serverName,
          coverageSource: reportPath,
          patchTarget: pipeline.config.coverage.targets.patch,
        });
        return json(summarizePlan(plan));
      }
      return json(summarizePlan(pipeline.plan));
    },
  );

  server.registerTool(
    'generate_test_plan',
    {
      title: 'Generate full automation plan',
      description:
        'Produce a complete, ordered plan: per-gap briefs for unit/integration/component plus Playwright MCP prompts for UI layers. Agents should execute every work item.',
      inputSchema: {
        cwd: z.string().optional(),
        base: z.string().optional(),
        reportPath: z.string().optional(),
        includeUntracked: z.boolean().optional(),
      },
    },
    async ({ cwd, base, reportPath, includeUntracked }) => {
      const pipeline = runPipeline({
        cwd: cwd ?? process.cwd(),
        base,
        includeUntracked,
      });
      let plan = pipeline.plan;
      if (reportPath) {
        const report = loadCoverageFile(reportPath, pipeline.repoRoot);
        plan = recommendPlan({
          repoRoot: pipeline.repoRoot,
          gaps: buildGaps(pipeline.files, report),
          packages: pipeline.packages,
          layers: pipeline.config.layers,
          ignore: pipeline.config.coverage.ignore,
          playwrightServerName: pipeline.config.playwrightMcp.serverName,
          coverageSource: reportPath,
          patchTarget: pipeline.config.coverage.targets.patch,
        });
      }
      return json(plan);
    },
  );

  server.registerTool(
    'generate_layer_brief',
    {
      title: 'Generate one layer brief',
      description:
        'Generate a single-layer implementation brief (unit, integration, component, smoke, or a custom YAML layer).',
      inputSchema: {
        cwd: z.string().optional(),
        layerId: z.string().describe('Layer id from list_layers'),
        base: z.string().optional(),
      },
    },
    async ({ cwd, layerId, base }) => {
      const pipeline = runPipeline({ cwd: cwd ?? process.cwd(), base });
      const items = pipeline.plan.workItems.filter(item => item.layerId === layerId);
      if (items.length === 0) {
        return json({
          layerId,
          items: [],
          note: 'No work items for this layer on the current diff/coverage.',
        });
      }
      return text(items.map(item => item.brief).join('\n\n---\n\n'));
    },
  );

  server.registerTool(
    'generate_playwright_brief',
    {
      title: 'Generate Playwright MCP brief',
      description:
        'Generate the explore-then-write prompt for Playwright MCP from UI coverage gaps. Pair with the playwright MCP server (--caps=testing). Do not write spec code until you have used browser_* tools.',
      inputSchema: {
        cwd: z.string().optional(),
        base: z.string().optional(),
      },
    },
    async ({ cwd, base }) => {
      const pipeline = runPipeline({ cwd: cwd ?? process.cwd(), base });
      const items = pipeline.plan.workItems.filter(item => item.playwrightMcp);
      if (items.length === 0) {
        return json({
          items: [],
          note: 'No UI-layer gaps on this diff. Use generate_layer_brief for unit/integration/component.',
        });
      }
      return text(
        items
          .map(item => item.playwrightPrompt ?? item.brief)
          .join('\n\n========== NEXT SCENARIO ==========\n\n'),
      );
    },
  );

  server.registerPrompt(
    'fill_automation_gaps',
    {
      title: 'Fill automation gaps from coverage',
      description:
        'Orchestrate change analysis, coverage gaps, and generation of every appropriate test layer, using Playwright MCP for UI.',
      argsSchema: {
        cwd: z.string().optional().describe('Repo or workspace directory'),
        base: z.string().optional().describe('Git base ref'),
      },
    },
    async ({ cwd, base }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              'Fill all appropriate automation for the current changes using the automation-coverage MCP, then Playwright MCP for UI.',
              cwd ? `cwd: ${cwd}` : '',
              base ? `base: ${base}` : '',
              '',
              'Steps:',
              '1. Call list_layers and discover_packages.',
              '2. Call analyze_changes then coverage_gaps (run yarn test --coverage first if no report exists).',
              '3. Call generate_test_plan.',
              '4. For each non-UI work item: open the template, mirror it, write the test, run the listed command.',
              '5. For each playwrightMcp work item: follow generate_playwright_brief with the playwright MCP. Explore first; then write the spec.',
              '6. Do not duplicate the same assertion at a more expensive layer.',
              '7. Do not write tests whose only purpose is a coverage percentage.',
            ]
              .filter(Boolean)
              .join('\n'),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'playwright_from_coverage',
    {
      title: 'Playwright MCP from coverage gaps',
      description:
        'Use Playwright MCP to explore uncovered UI and write durable e2e specs. Requires @playwright/mcp with --caps=testing.',
      argsSchema: {
        cwd: z.string().optional(),
      },
    },
    async ({ cwd }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              'Call generate_playwright_brief on the automation-coverage MCP' +
                (cwd ? ` with cwd=${cwd}` : '') +
                '.',
              'Then execute each brief with Playwright MCP tools only:',
              'browser_navigate → browser_snapshot → interact → browser_generate_locator → browser_verify_* → write @playwright/test spec → run → iterate.',
              'Mirror the template file named in the brief. Prefer page objects and translation keys.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'unit_from_coverage',
    {
      title: 'Unit/integration tests from coverage gaps',
      description: 'Generate Jest/RTL/startTestBackend tests for uncovered changed lines.',
      argsSchema: {
        cwd: z.string().optional(),
        layerId: z
          .string()
          .optional()
          .describe('unit | integration | component (default: all non-UI)'),
      },
    },
    async ({ cwd, layerId }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              'Call generate_test_plan' + (cwd ? ` with cwd=${cwd}` : '') + '.',
              layerId
                ? `Implement only layerId=${layerId} work items.`
                : 'Implement every work item where playwrightMcp is false.',
              'Mirror the template. Run yarn test on the new file. Stop if the template path does not exist — glob for a sibling instead of inventing imports.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  server.registerResource(
    'layers',
    'layers://registry',
    {
      title: 'Layer registry',
      description: 'Currently configured pluggable test layers',
      mimeType: 'application/json',
    },
    async () => {
      const config = loadConfig(process.cwd());
      return {
        contents: [
          {
            uri: 'layers://registry',
            mimeType: 'application/json',
            text: JSON.stringify(config.layers, null, 2),
          },
        ],
      };
    },
  );

  server.registerResource(
    'principles',
    'coverage://principles',
    {
      title: 'Coverage-driven automation principles',
      mimeType: 'text/plain',
    },
    async () => ({
      contents: [
        {
          uri: 'coverage://principles',
          mimeType: 'text/plain',
          text: PLAN_PRINCIPLES.join('\n'),
        },
      ],
    }),
  );

  return server;
}

function summarizePackage(pkg: DiscoveredPackage) {
  return {
    id: pkg.id,
    name: pkg.name,
    path: pkg.path,
    repoKey: pkg.repoKey,
    repoKind: pkg.repoKind,
    workspace: pkg.workspace,
    role: pkg.role,
    hasPlaywright: pkg.hasPlaywright,
  };
}

function resolvePackage(
  packages: DiscoveredPackage[],
  packageId?: string,
  packagePath?: string,
  cwd?: string,
): DiscoveredPackage | undefined {
  if (packageId) {
    return packages.find(pkg => pkg.id === packageId);
  }
  if (packagePath) {
    return packageForPath(packages, packagePath) ?? packages.find(pkg => pkg.path === packagePath);
  }
  if (cwd) {
    return packageForPath(packages, cwd);
  }
  return undefined;
}

function summarizePlan(plan: TestPlan) {
  return {
    summary: plan.summary,
    principles: plan.principles,
    coverageSource: plan.coverageSource,
    items: plan.workItems.map(item => ({
      id: item.id,
      layerId: item.layerId,
      ladder: item.ladder,
      cost: item.cost,
      playwrightMcp: item.playwrightMcp,
      packageName: item.packageName,
      sourceFile: item.sourceFile,
      filePct: item.filePct,
      uncoveredChangedLines: item.uncoveredChangedLines,
      outputPath: item.outputPath,
      template: item.template,
      failureToCatch: item.failureToCatch,
    })),
    skipped: plan.skipped,
  };
}
