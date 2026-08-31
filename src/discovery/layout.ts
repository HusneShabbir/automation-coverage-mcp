import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import type {
  BackstageRole,
  DiscoveredPackage,
  ForestRepo,
  RepoKind,
} from '../types.js';

const KNOWN_REPOS: Array<{ dir: string; key: string; kind: RepoKind }> = [
  { dir: 'rhdh-plugins', key: 'plugins', kind: 'backstage-workspaces' },
  { dir: 'community-plugins', key: 'community', kind: 'backstage-workspaces' },
  { dir: 'rhdh', key: 'rhdh', kind: 'rhdh-monorepo' },
  { dir: 'rhdh-plugin-export-overlays', key: 'overlay', kind: 'overlay-workspaces' },
  { dir: 'lightspeed-playwright-e2e', key: 'shared-e2e', kind: 'shared-playwright' },
  { dir: 'backstage', key: 'backstage', kind: 'backstage-monorepo' },
];

function readJson(path: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function backstageRole(pkg: Record<string, unknown> | undefined): BackstageRole {
  const backstage = pkg?.backstage as { role?: string } | undefined;
  const role = backstage?.role;
  const allowed: BackstageRole[] = [
    'frontend-plugin',
    'backend-plugin',
    'frontend-plugin-module',
    'backend-plugin-module',
    'common-library',
    'node-library',
    'web-library',
    'frontend',
    'backend',
    'cli',
  ];
  if (role && (allowed as string[]).includes(role)) {
    return role as BackstageRole;
  }
  return 'unknown';
}

function findPlaywrightConfig(dir: string): string | undefined {
  for (const name of [
    'playwright.config.ts',
    'playwright.config.js',
    'playwright.config.mts',
  ]) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function listDirs(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .map(name => join(dir, name))
    .filter(path => {
      try {
        return statSync(path).isDirectory() && !basename(path).startsWith('.');
      } catch {
        return false;
      }
    });
}

export function detectRepoKind(root: string): RepoKind {
  if (existsSync(join(root, 'workspaces')) && existsSync(join(root, 'package.json'))) {
    const pkg = readJson(join(root, 'package.json'));
    const name = String(pkg?.name ?? '');
    if (name.includes('rhdh-plugins') || name.includes('community-plugins')) {
      return 'backstage-workspaces';
    }
    if (basename(root).includes('overlay')) {
      return 'overlay-workspaces';
    }
  }
  if (existsSync(join(root, 'e2e-tests')) && existsSync(join(root, 'plugins'))) {
    return 'rhdh-monorepo';
  }
  if (existsSync(join(root, 'src')) && basename(root).includes('playwright')) {
    return 'shared-playwright';
  }
  return 'generic';
}

export function discoverForest(startDir: string, configured: ForestRepo[] = []): ForestRepo[] {
  if (configured.length) {
    return configured
      .filter(repo => existsSync(repo.path))
      .map(repo => ({ ...repo, path: resolve(repo.path) }));
  }

  let dir = resolve(startDir);
  const seen = new Map<string, ForestRepo>();

  for (let i = 0; i < 12; i += 1) {
    const names = existsSync(dir) ? readdirSync(dir) : [];
    let foundHere = false;
    for (const known of KNOWN_REPOS) {
      if (names.includes(known.dir)) {
        foundHere = true;
        const path = resolve(dir, known.dir);
        seen.set(known.key, { key: known.key, path, kind: known.kind });
      }
    }
    // This directory is the forest parent (siblings like rhdh-plugins, rhdh).
    if (foundHere) {
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  if (seen.size === 0) {
    const root = resolve(startDir);
    seen.set('cwd', { key: 'cwd', path: root, kind: detectRepoKind(root) });
  }
  return [...seen.values()];
}

function packageFromDir(
  dir: string,
  repo: ForestRepo,
  workspace?: string,
): DiscoveredPackage | undefined {
  const pkgPath = join(dir, 'package.json');
  const pkg = readJson(pkgPath);
  if (!pkg) {
    return undefined;
  }
  const name = String(pkg.name ?? basename(dir));
  const playwrightConfig =
    findPlaywrightConfig(dir) ??
    (workspace ? findPlaywrightConfig(join(repo.path, 'workspaces', workspace)) : undefined) ??
    findPlaywrightConfig(repo.path);
  return {
    id: `${repo.key}:${relative(repo.path, dir).replaceAll('\\', '/') || '.'}`,
    name,
    path: dir,
    relPath: relative(repo.path, dir).replaceAll('\\', '/'),
    repoKey: repo.key,
    repoKind: repo.kind,
    repoRoot: repo.path,
    workspace,
    role: backstageRole(pkg),
    hasPlaywright: Boolean(playwrightConfig),
    playwrightConfig,
  };
}

function discoverBackstageWorkspaces(repo: ForestRepo): DiscoveredPackage[] {
  const out: DiscoveredPackage[] = [];
  for (const workspaceDir of listDirs(join(repo.path, 'workspaces'))) {
    const workspace = basename(workspaceDir);
    for (const pluginDir of listDirs(join(workspaceDir, 'plugins'))) {
      const pkg = packageFromDir(pluginDir, repo, workspace);
      if (pkg) {
        out.push(pkg);
      }
    }
    for (const packageDir of listDirs(join(workspaceDir, 'packages'))) {
      const pkg = packageFromDir(packageDir, repo, workspace);
      if (pkg) {
        out.push(pkg);
      }
    }
  }
  return out;
}

function discoverRhdhMonorepo(repo: ForestRepo): DiscoveredPackage[] {
  const out: DiscoveredPackage[] = [];
  for (const dir of [...listDirs(join(repo.path, 'plugins')), ...listDirs(join(repo.path, 'packages'))]) {
    const pkg = packageFromDir(dir, repo);
    if (pkg) {
      out.push(pkg);
    }
  }
  return out;
}

function discoverOverlay(repo: ForestRepo): DiscoveredPackage[] {
  const out: DiscoveredPackage[] = [];
  for (const workspaceDir of listDirs(join(repo.path, 'workspaces'))) {
    const workspace = basename(workspaceDir);
    const e2e = join(workspaceDir, 'e2e-tests');
    if (existsSync(e2e)) {
      out.push({
        id: `${repo.key}:${workspace}/e2e-tests`,
        name: `${workspace}-overlay-e2e`,
        path: e2e,
        relPath: relative(repo.path, e2e).replaceAll('\\', '/'),
        repoKey: repo.key,
        repoKind: repo.kind,
        repoRoot: repo.path,
        workspace,
        role: 'unknown',
        hasPlaywright: Boolean(findPlaywrightConfig(e2e) ?? findPlaywrightConfig(workspaceDir)),
        playwrightConfig: findPlaywrightConfig(e2e) ?? findPlaywrightConfig(workspaceDir),
      });
    }
  }
  const smoke = join(repo.path, 'smoke-tests-native');
  if (existsSync(smoke)) {
    out.push({
      id: `${repo.key}:smoke-tests-native`,
      name: 'overlay-native-smoke',
      path: smoke,
      relPath: 'smoke-tests-native',
      repoKey: repo.key,
      repoKind: repo.kind,
      repoRoot: repo.path,
      role: 'unknown',
      hasPlaywright: false,
    });
  }
  return out;
}

export function discoverPackages(forest: ForestRepo[]): DiscoveredPackage[] {
  const packages: DiscoveredPackage[] = [];
  for (const repo of forest) {
    if (!existsSync(repo.path)) {
      continue;
    }
    switch (repo.kind) {
      case 'backstage-workspaces':
      case 'backstage-monorepo':
        packages.push(...discoverBackstageWorkspaces(repo));
        if (repo.kind === 'backstage-monorepo') {
          packages.push(...discoverRhdhMonorepo(repo));
        }
        break;
      case 'rhdh-monorepo':
        packages.push(...discoverRhdhMonorepo(repo));
        break;
      case 'overlay-workspaces':
        packages.push(...discoverOverlay(repo));
        break;
      case 'shared-playwright':
      case 'generic': {
        const pkg = packageFromDir(repo.path, repo);
        if (pkg) {
          packages.push(pkg);
        }
        break;
      }
      default:
        break;
    }
  }
  return packages;
}

export function packageForPath(
  packages: DiscoveredPackage[],
  absPath: string,
): DiscoveredPackage | undefined {
  return [...packages]
    .sort((a, b) => b.path.length - a.path.length)
    .find(pkg => absPath === pkg.path || absPath.startsWith(`${pkg.path}/`));
}
