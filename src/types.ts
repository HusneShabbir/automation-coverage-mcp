export type RepoKind =
  | 'backstage-workspaces'
  | 'rhdh-monorepo'
  | 'overlay-workspaces'
  | 'shared-playwright'
  | 'backstage-monorepo'
  | 'generic';

export type FileKind =
  | 'unit-logic'
  | 'react-component'
  | 'react-page'
  | 'frontend-api'
  | 'frontend-hook'
  | 'backend-router'
  | 'backend-service'
  | 'backend-plugin'
  | 'plugin-wiring'
  | 'config'
  | 'overlay-metadata'
  | 'e2e-test'
  | 'unit-test'
  | 'platform'
  | 'docs'
  | 'other';

export type LayerKind =
  | 'unit'
  | 'integration'
  | 'component'
  | 'ui'
  | 'smoke'
  | 'custom';

export type LayerLadder = 'L1' | 'L2' | 'L3' | 'L4a' | 'L4b' | 'smoke' | 'custom';

export type Cost = 'ms' | 's' | 'min' | 'cluster';

export type BackstageRole =
  | 'frontend-plugin'
  | 'backend-plugin'
  | 'frontend-plugin-module'
  | 'backend-plugin-module'
  | 'common-library'
  | 'node-library'
  | 'web-library'
  | 'frontend'
  | 'backend'
  | 'cli'
  | 'unknown';

export interface LayerLocate {
  /** Colocate next to the source file (Backstage plugin convention). */
  neighbor: boolean;
  directory?: string;
  naming?: string;
}

export interface LayerDefinition {
  id: string;
  title: string;
  description: string;
  kind: LayerKind;
  ladder: LayerLadder;
  cost: Cost;
  cluster: boolean;
  docker: boolean;
  playwrightMcp: boolean;
  fileGlobs: string[];
  fileKinds?: FileKind[];
  repoKinds?: RepoKind[];
  testGlobs: string[];
  excludeGlobs?: string[];
  templateHints: string[];
  locate: LayerLocate;
  runCommand?: string;
  generator: string;
}

export interface ForestRepo {
  key: string;
  path: string;
  kind: RepoKind;
}

export interface CoverageTargets {
  /** Informational target; never a merge gate. */
  default: number;
  patch: number;
}

export interface AppConfig {
  forest: ForestRepo[];
  coverage: {
    targets: CoverageTargets;
    reportNames: string[];
    ignore: string[];
  };
  playwrightMcp: {
    enabled: boolean;
    serverName: string;
    testingCaps: boolean;
  };
  layers: LayerDefinition[];
  disabledLayers: string[];
}

export interface DiscoveredPackage {
  id: string;
  name: string;
  path: string;
  relPath: string;
  repoKey: string;
  repoKind: RepoKind;
  repoRoot: string;
  workspace?: string;
  role: BackstageRole;
  hasPlaywright: boolean;
  playwrightConfig?: string;
}

export interface ChangedLineRange {
  start: number;
  end: number;
}

export interface ChangedFile {
  path: string;
  relPath: string;
  status: 'added' | 'modified' | 'deleted' | 'untracked';
  addedLines: number[];
  hunks: ChangedLineRange[];
  packageId?: string;
  fileKind: FileKind;
}

export interface FileCoverage {
  path: string;
  relPath: string;
  lines: Record<number, number>;
  covered: number;
  uncovered: number;
  total: number;
  pct: number;
}

export interface CoverageReport {
  source: string;
  files: FileCoverage[];
}

export interface CoverageGap {
  file: ChangedFile;
  coverage?: FileCoverage;
  uncoveredChangedLines: number[];
  coveredChangedLines: number[];
  filePct: number | null;
  symbols: string[];
  snippet: string;
}

export interface TestRecord {
  file: string;
  layerId: string;
  titles: Array<{ kind: 'describe' | 'test'; title: string }>;
}

export interface WorkItem {
  id: string;
  layerId: string;
  layerTitle: string;
  ladder: LayerLadder;
  cost: Cost;
  playwrightMcp: boolean;
  packageId: string;
  packageName: string;
  packagePath: string;
  sourceFile: string;
  uncoveredChangedLines: number[];
  filePct: number | null;
  failureToCatch: string;
  symbols: string[];
  template?: string;
  outputPath: string;
  runCommand?: string;
  brief: string;
  playwrightPrompt?: string;
  reasons: string[];
}

export interface TestPlan {
  repoRoot: string;
  summary: string;
  principles: string[];
  coverageSource?: string;
  mode?: 'diff' | 'workspace';
  workItems: WorkItem[];
  skipped: Array<{ file: string; reason: string }>;
}
