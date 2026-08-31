import { attachPackages, analyzeGitChanges } from './git/diff.js';
import { findCoverageReport } from './coverage/find.js';
import { buildGaps } from './coverage/gaps.js';
import { discoverPackages } from './discovery/layout.js';
import { loadConfig } from './config/load.js';
import { recommendPlan } from './plan/recommend.js';
import type { AppConfig, ChangedFile, CoverageGap, DiscoveredPackage, TestPlan } from './types.js';

export interface PipelineResult {
  config: AppConfig;
  packages: DiscoveredPackage[];
  repoRoot: string;
  base?: string;
  files: ChangedFile[];
  coverageSource?: string;
  gaps: CoverageGap[];
  plan: TestPlan;
}

export function runPipeline(options: {
  cwd: string;
  base?: string;
  includeUncommitted?: boolean;
  includeUntracked?: boolean;
  coverageRoot?: string;
}): PipelineResult {
  const config = loadConfig(options.cwd);
  const packages = discoverPackages(config.forest);
  const git = analyzeGitChanges({
    cwd: options.cwd,
    base: options.base,
    includeUncommitted: options.includeUncommitted,
    includeUntracked: options.includeUntracked,
  });
  const files = attachPackages(git.files, packages);
  const searchRoots = [
    options.coverageRoot,
    options.cwd,
    git.repoRoot,
    ...packages.map(pkg => pkg.path),
  ].filter((p): p is string => Boolean(p));
  const found = findCoverageReport(searchRoots, config.coverage.reportNames);
  const gaps = buildGaps(files, found?.report);
  const plan = recommendPlan({
    repoRoot: git.repoRoot,
    gaps,
    packages,
    layers: config.layers,
    ignore: config.coverage.ignore,
    playwrightServerName: config.playwrightMcp.serverName,
    coverageSource: found?.path,
    patchTarget: config.coverage.targets.patch,
  });
  return {
    config,
    packages,
    repoRoot: git.repoRoot,
    base: git.base,
    files,
    coverageSource: found?.path,
    gaps,
    plan,
  };
}
