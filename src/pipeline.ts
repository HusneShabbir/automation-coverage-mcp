import { resolve } from 'node:path';
import { attachPackages, analyzeGitChanges } from './git/diff.js';
import { findCoverageReports, mergeReports } from './coverage/find.js';
import { buildGaps } from './coverage/gaps.js';
import { discoverPackages } from './discovery/layout.js';
import { packagesUnderCwd, scanWorkspaceSource } from './discovery/source-scan.js';
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
  mode: 'diff' | 'workspace';
}

export function runPipeline(options: {
  cwd: string;
  base?: string;
  includeUncommitted?: boolean;
  includeUntracked?: boolean;
  coverageRoot?: string;
  mode?: 'diff' | 'workspace';
  workspace?: string;
}): PipelineResult {
  const config = loadConfig(options.cwd);
  const allPackages = discoverPackages(config.forest);
  const packages = packagesUnderCwd(allPackages, options.cwd, options.workspace);
  const scoped = packages.length ? packages : allPackages;

  const git = analyzeGitChanges({
    cwd: options.cwd,
    base: options.base,
    includeUncommitted: options.includeUncommitted,
    includeUntracked: options.includeUntracked,
  });
  let files = attachPackages(git.files, scoped).filter(file =>
    scoped.some(pkg => file.packageId === pkg.id || file.path.startsWith(`${pkg.path}/`)),
  );

  const searchRoots = [
    options.coverageRoot,
    options.cwd,
    ...scoped.map(pkg => pkg.path),
  ].filter((p): p is string => Boolean(p));
  const reports = findCoverageReports(searchRoots, config.coverage.reportNames);
  const found = reports.length
    ? {
        path: reports.map(r => r.path).join(', '),
        report: reports.length === 1 ? reports[0].report : mergeReports(reports.map(r => r.report)),
      }
    : undefined;

  let mode: 'diff' | 'workspace' = options.mode ?? 'diff';
  if (mode === 'workspace' || (mode === 'diff' && files.length === 0 && scoped.length > 0)) {
    mode = 'workspace';
    const cwdRoot = resolve(options.cwd);
    files = scanWorkspaceSource({
      packages: scoped.filter(
        pkg => pkg.path === cwdRoot || pkg.path.startsWith(`${cwdRoot}/`),
      ),
      repoRoot: git.repoRoot,
      ignore: config.coverage.ignore,
      coverage: found?.report,
    });
  }

  const gaps = buildGaps(files, found?.report);
  const plan = recommendPlan({
    repoRoot: git.repoRoot,
    gaps,
    packages: scoped,
    layers: config.layers,
    ignore: config.coverage.ignore,
    playwrightServerName: config.playwrightMcp.serverName,
    coverageSource: found?.path,
    patchTarget: config.coverage.targets.patch,
    mode,
  });
  return {
    config,
    packages: scoped,
    repoRoot: git.repoRoot,
    base: git.base,
    files,
    coverageSource: found?.path,
    gaps,
    plan,
    mode,
  };
}
