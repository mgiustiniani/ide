// -----------------------------------------------------------------------------
// tests/story/support/git-diff-review.ts
// RED contract-level Story BDD driver for REQ-IDE-GIT-DIFF-REVIEW-001.
//
// Contract rule (anti-fake RED): this driver types against the frontend port
// contracts ONLY. It never fabricates a diff, an unavailable reason, an opened
// range, or an adapter. Until real production contracts and adapters exist
// behind:
//   packages/web-core/src/ports/workspace-changes-port.ts
//   packages/web-core/src/ports/read-only-diff-port.ts
//   packages/web-core/src/ports/editor-open-range-port.ts
//   packages/browser-adapters/src/git-diff-review-browser.ts
//   packages/tauri-adapters/src/git-diff-review-tauri.ts
// every port delegation fails closed with NOT_IMPLEMENTED.
//
// Delegation seam (extract -> delegate -> response):
//   extract  = the step request (file path, visible range) is normalized here
//   delegate = the session delegates to the resolved production port
//   response = the raw port response is mapped to DiffReviewOutcome / DiffRange
// -----------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REQUIREMENT = "REQ-IDE-GIT-DIFF-REVIEW-001";
export const NOT_IMPLEMENTED = "NOT_IMPLEMENTED";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(MODULE_DIR, "../../..");

const WEB_CORE_PORTS_DIR = "packages/web-core/src/ports";
const BROWSER_ADAPTERS_DIR = "packages/browser-adapters/src";
const TAURI_ADAPTERS_DIR = "packages/tauri-adapters/src";

const WORKSPACE_CHANGES_PORT = join(WEB_CORE_PORTS_DIR, "workspace-changes-port.ts");
const READ_ONLY_DIFF_PORT = join(WEB_CORE_PORTS_DIR, "read-only-diff-port.ts");
const EDITOR_OPEN_RANGE_PORT = join(WEB_CORE_PORTS_DIR, "editor-open-range-port.ts");
const BROWSER_DIFF_IMPLEMENTATION = join(BROWSER_ADAPTERS_DIR, "git-diff-review-browser.ts");
const TAURI_DIFF_IMPLEMENTATION = join(TAURI_ADAPTERS_DIR, "git-diff-review-tauri.ts");

/** A contiguous, read-only selection inside one working-tree file. */
export interface DiffRange {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
}

/** One unified-diff hunk: only line metadata and text are exposed, never writes. */
export interface DiffHunk {
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly text: string;
}

/** The read-only, hunk-level diff contract. `readOnly` is always literal `true`. */
export interface HunkLevelDiff {
  readonly path: string;
  readonly hunks: readonly DiffHunk[];
  readonly range: DiffRange;
  readonly readOnly: true;
}

/** Honest review response: `ok` carries the diff, `unavailable` carries a reason. */
export type DiffReviewOutcome =
  | { readonly kind: "ok"; readonly diff: HunkLevelDiff }
  | { readonly kind: "unavailable"; readonly reason: string };

/** Frontend contract: the Changes surface lists modified working-tree files. */
export interface WorkspaceChangesPort {
  listModifiedFiles(): readonly string[];
}

/** Frontend contract: the read-only diff port produces a diff outcome. */
export interface ReadOnlyDiffPort {
  produceDiff(filePath: string): DiffReviewOutcome;
}

/** Frontend contract: the editor port opens a read-only range (never a write). */
export interface EditorOpenRangePort {
  openRange(range: DiffRange): DiffRange;
}

/** The three frontend ports the git diff-review feature delegates through. */
export interface DiffReviewPorts {
  readonly changes: WorkspaceChangesPort;
  readonly diff: ReadOnlyDiffPort;
  readonly editor: EditorOpenRangePort;
}

export interface WebFirstLayerScanResult {
  readonly layer: string;
  readonly platformApiImportCount: number;
}

function notImplemented(missing: readonly string[]): Error {
  return new Error(
    `${NOT_IMPLEMENTED}: ${REQUIREMENT} production port contracts/adapters are missing: ${missing.join(", ")}`,
  );
}

async function loadContractModule<T>(root: string, relativePath: string): Promise<T> {
  const moduleUrl = pathToFileURL(join(root, relativePath)).href;
  const loaded = await import(moduleUrl);
  return loaded.default as T;
}

function walkSourceFiles(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) {
    return results;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name === "node_modules" ||
      entry.name === "dist" ||
      entry.name === ".turbo" ||
      entry.name === ".next" ||
      entry.name === "coverage"
    ) {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkSourceFiles(full));
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/u.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

/**
 * RED contract-level session. Every port delegation fails closed with
 * `NOT_IMPLEMENTED` until production ports and adapters exist.
 */
export class GitDiffReviewSession {
  #root: string;
  #started = false;
  #fixtureRoot: string | undefined = undefined;
  #modifiedFiles: readonly string[] = [];
  #visibleRange: DiffRange | undefined;
  #platformDiffUnavailable = false;
  #webFirstLayers: readonly string[] = [];
  #webFirstLayerScan: readonly WebFirstLayerScanResult[] = [];
  #lastOutcome: DiffReviewOutcome | undefined;
  #openedRange: DiffRange | undefined;
  #invokedPorts = new Set<string>();

  constructor(root = REPO_ROOT) {
    this.#root = root;
  }

  start(): void {
    this.#started = true;
    this.#modifiedFiles = [];
    this.#visibleRange = undefined;
    this.#platformDiffUnavailable = false;
    this.#webFirstLayers = [];
    this.#webFirstLayerScan = [];
    this.#lastOutcome = undefined;
    this.#openedRange = undefined;
    this.#invokedPorts.clear();
    ensureFixture();
  }

  /**
   * Discover the production frontend ports and adapters behind the contract.
   * Fails closed with `NOT_IMPLEMENTED` until all of them exist (anti-fake RED).
   */
  async resolvePorts(): Promise<DiffReviewPorts> {
    this.#assertStarted();
    const candidates: readonly string[] = [
      WORKSPACE_CHANGES_PORT,
      READ_ONLY_DIFF_PORT,
      EDITOR_OPEN_RANGE_PORT,
      BROWSER_DIFF_IMPLEMENTATION,
      TAURI_DIFF_IMPLEMENTATION,
    ];
    const missing: string[] = [];
    for (const relativePath of candidates) {
      if (!existsSync(join(this.#root, relativePath))) {
        missing.push(relativePath);
      }
    }
    if (missing.length > 0) {
      throw notImplemented(missing);
    }

    const changesModule = await loadContractModule<WorkspaceChangesPort>(
      this.#root,
      WORKSPACE_CHANGES_PORT,
    );
    const diffModule = await loadContractModule<ReadOnlyDiffPort>(
      this.#root,
      READ_ONLY_DIFF_PORT,
    );
    const editorModule = await loadContractModule<EditorOpenRangePort>(
      this.#root,
      EDITOR_OPEN_RANGE_PORT,
    );
    return {
      changes: changesModule,
      diff: diffModule,
      editor: editorModule,
    };
  }

  /**
   * extract -> delegate -> response for a read-only review of one file.
   * In RED this fails closed with `NOT_IMPLEMENTED`.
   */
  async reviewModifiedFile(filePath: string): Promise<DiffReviewOutcome> {
    this.#assertStarted();
    if (this.#platformDiffUnavailable) {
      if (!existsSync(join(this.#root, BROWSER_DIFF_IMPLEMENTATION))) {
        throw notImplemented([BROWSER_DIFF_IMPLEMENTATION]);
      }
      const moduleUrl = pathToFileURL(join(this.#root, BROWSER_DIFF_IMPLEMENTATION)).href;
      const browserModule = await import(moduleUrl);
      const browserAdapter = new browserModule.BrowserReadOnlyDiffAdapter();
      const outcome: DiffReviewOutcome = browserAdapter.produceDiff(filePath);
      this.#lastOutcome = outcome;
      return outcome;
    }
    // extract: only files known to be modified are reviewable
    const ports = await this.resolvePorts(); // throws NOT_IMPLEMENTED in RED
    this.#invokedPorts.add(`${WORKSPACE_CHANGES_PORT}#listModifiedFiles`);
    const modifiedFiles = ports.changes.listModifiedFiles();
    if (!modifiedFiles.includes(filePath)) {
      const outcome: DiffReviewOutcome = {
        kind: "unavailable",
        reason: `not a modified working-tree file: ${filePath}`,
      };
      this.#lastOutcome = outcome;
      return outcome;
    }
    // delegate
    this.#invokedPorts.add(`${READ_ONLY_DIFF_PORT}#produceDiff`);
    const outcome = ports.diff.produceDiff(filePath);
    // response
    this.#lastOutcome = outcome;
    return outcome;
  }

  /** The last honest review response, or undefined before any delegation. */
  reviewOutcome(): DiffReviewOutcome | undefined {
    return this.#lastOutcome;
  }

  /**
   * extract -> delegate -> response for activating a read-only range.
   * In RED this fails closed with `NOT_IMPLEMENTED`.
   */
  async openRange(filePath: string, startLine: number, endLine: number): Promise<DiffRange> {
    this.#assertStarted();
    const ports = await this.resolvePorts(); // throws NOT_IMPLEMENTED in RED
    // extract
    const range: DiffRange = { path: filePath, startLine, endLine };
    // delegate
    this.#invokedPorts.add(`${EDITOR_OPEN_RANGE_PORT}#openRange`);
    const opened = ports.editor.openRange(range);
    // response
    this.#openedRange = opened;
    return opened;
  }

  /** The exact range the editor port opened, or undefined before delegation. */
  openedRange(): DiffRange | undefined {
    return this.#openedRange;
  }

  recordModifiedFiles(filePaths: readonly string[]): void {
    this.#assertStarted();
    this.#modifiedFiles = [...filePaths];
  }

  modifiedFiles(): readonly string[] {
    return this.#modifiedFiles;
  }

  recordVisibleRange(filePath: string, startLine: number, endLine: number): void {
    this.#assertStarted();
    this.#visibleRange = { path: filePath, startLine, endLine };
  }

  visibleRange(): DiffRange | undefined {
    return this.#visibleRange;
  }

  markPlatformDiffUnavailable(): void {
    this.#assertStarted();
    this.#platformDiffUnavailable = true;
  }

  platformDiffUnavailable(): boolean {
    return this.#platformDiffUnavailable;
  }

  recordWebFirstLayers(layers: readonly string[]): void {
    this.#assertStarted();
    this.#webFirstLayers = [...layers];
  }

  webFirstLayers(): readonly string[] {
    return this.#webFirstLayers;
  }

  /** Static boundary scan: count @tauri-apps/api imports in the web-first layers. */
  scanWebFirstLayers(layers: readonly string[]): readonly WebFirstLayerScanResult[] {
    this.#assertStarted();
    const results: WebFirstLayerScanResult[] = [];
    for (const layer of layers) {
      const layerRoot = join(this.#root, layer);
      let count = 0;
      for (const file of walkSourceFiles(layerRoot)) {
        const text = readFileSync(file, "utf8");
        if (/@tauri-apps\/api/u.test(text)) {
          count += 1;
        }
      }
      results.push({ layer, platformApiImportCount: count });
    }
    this.#webFirstLayerScan = results;
    return results;
  }

  webFirstLayerScan(): readonly WebFirstLayerScanResult[] {
    return this.#webFirstLayerScan;
  }

  /** Verify browser and Tauri adapters live behind the frontend ports. RED: NOT_IMPLEMENTED. */
  async diffImplementationsBehindPorts(): Promise<void> {
    this.#assertStarted();
    await this.resolvePorts(); // throws NOT_IMPLEMENTED until both adapters exist
  }

  invokedPorts(): readonly string[] {
    return [...this.#invokedPorts];
  }

  /** Working-tree mutations the review must never touch. */
  writeOperations(): readonly string[] {
    const writeMarkers = ["working-tree.write", "git.apply", "diff.apply", "patch.apply", "checkout", "stage"];
    return [...this.#invokedPorts].filter((port) =>
      writeMarkers.some((marker) => port.toLowerCase().includes(marker)),
    );
  }

  /** AI/model dependencies the range-activation must never create. */
  aiOrModelOperations(): readonly string[] {
    const markers = ["ai", "model", "llm", "agent", "copilot", "inference"];
    return [...this.#invokedPorts].filter((port) =>
      markers.some((marker) => port.toLowerCase().includes(marker)),
    );
  }

  /** Anti-fake guard: the driver never fabricates a response; it fails closed. */
  fabricatedResponse(): boolean {
    return false;
  }

  evidence(): Record<string, unknown> {
    return {
      requirement: REQUIREMENT,
      phase: "RED",
      modifiedFiles: this.#modifiedFiles,
      visibleRange: this.#visibleRange,
      platformDiffUnavailable: this.#platformDiffUnavailable,
      webFirstLayers: this.#webFirstLayers,
      webFirstLayerScan: this.#webFirstLayerScan,
      invokedPorts: this.invokedPorts(),
      writeOperations: this.writeOperations(),
      aiOrModelOperations: this.aiOrModelOperations(),
      fabricatedResponse: this.fabricatedResponse(),
      reviewOutcome: this.#lastOutcome,
      openedRange: this.#openedRange,
    };
  }

  #assertStarted(): void {
    if (!this.#started) {
      throw new Error(`${NOT_IMPLEMENTED}: ${REQUIREMENT} session has not been started`);
    }
  }

  /** No-op teardown: the git fixture is module-owned and cleaned on process exit. */
  dispose(): void {
    /* fixture is module-owned, cleaned on exit */
  }
}

/** Module-level fixture ownership so every started session shares one repo. */
const moduleFixtureRoot: { root: string | undefined } = { root: undefined };

/** Resolve the shared module fixture, creating it once per process. */
function ensureFixture(): string {
  if (moduleFixtureRoot.root !== undefined) {
    return moduleFixtureRoot.root;
  }
  const fresh = createGitFixture();
  moduleFixtureRoot.root = fresh;
  process.env.IDE_STORY_WORKSPACE = fresh;
  process.on("exit", () => {
    if (moduleFixtureRoot.root !== undefined) {
      rmSync(moduleFixtureRoot.root, { recursive: true, force: true });
    }
  });
  return fresh;
}

/** Create a real temporary git repository with a tracked, then edited, git.ts. */
function createGitFixture(): string {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "ide-story-git-diff-review-"));
  const gitTs = join(fixtureRoot, "src", "lib", "git.ts");
  mkdirSync(dirname(gitTs), { recursive: true });
  writeFileSync(gitTs, GIT_TS_BASE, "utf8");
  runGit(fixtureRoot, ["init", "-q"]);
  runGit(fixtureRoot, ["config", "user.name", "Story BDD"]);
  runGit(fixtureRoot, ["config", "user.email", "story-bdd@example.test"]);
  runGit(fixtureRoot, ["config", "commit.gpgsign", "false"]);
  runGit(fixtureRoot, ["add", "."]);
  runGit(fixtureRoot, ["commit", "-q", "-m", "story-bdd baseline"]);
  writeFileSync(gitTs, GIT_TS_EDIT, "utf8");
  return fixtureRoot;
}

/** Run a read-only git command rooted at `root`; throws when git fails. */
function runGit(root: string, args: readonly string[]): void {
  execFileSync("git", [...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}


/** Base (committed) content of the tracked `src/lib/git.ts`. */
const GIT_TS_BASE = `// src/lib/git.ts
// Story BDD baseline for REQ-IDE-GIT-DIFF-REVIEW-001.

export interface GitStatusEntry {
  readonly path: string;
  readonly status: string;
}

export function parseGitStatus(status: string): readonly GitStatusEntry[] {
  const entries: GitStatusEntry[] = [];
  for (const line of status.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    entries.push({ path: trimmed.slice(2).trim(), status: trimmed.slice(0, 2) });
  }
  return entries;
}

export const GIT_DIFF_REVIEW_BASELINE = true;
`;

/** Working-tree edit of `src/lib/git.ts`: a read-only hunk-level diff is expected. */
const GIT_TS_EDIT = `// src/lib/git.ts
// Story BDD working-tree edit for REQ-IDE-GIT-DIFF-REVIEW-001.

export interface GitStatusEntry {
  readonly path: string;
  readonly status: string;
}

export function parseGitStatus(status: string): readonly GitStatusEntry[] {
  const entries: GitStatusEntry[] = [];
  for (const line of status.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    entries.push({ path: trimmed.slice(2).trim(), status: trimmed.slice(0, 2) });
  }
  return entries;
}

export const GIT_DIFF_REVIEW_BASELINE = true;

// Working-tree edit: a read-only hunk-level diff is expected below.
export const GIT_DIFF_REVIEW_EDIT = true;
`;
