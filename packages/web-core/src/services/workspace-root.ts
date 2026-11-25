/**
 * Shared read-only git diff-review source for REQ-IDE-GIT-DIFF-REVIEW-001.
 *
 * Seam: extract -> delegate -> response.
 * - extract  = a working-tree path must be a known modified/added tracked path
 * - delegate = a read-only `git status --porcelain` / `git diff` invocation
 * - response = a DiffReviewOutcome (ok with hunks, or honest unavailable)
 *
 * The default port implementations delegate to a source created for the
 * resolved workspace root. The root is read from `IDE_STORY_WORKSPACE` once
 * and memoized; when the environment variable is unset it defaults to the
 * repository root discovered from this module location.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DiffHunk, DiffRange, DiffReviewOutcome } from "../ports/workspace-changes-port";

/** The environment variable that names the Story workspace root. */
export const IDE_STORY_WORKSPACE_ENV = "IDE_STORY_WORKSPACE";

/** Read-only git operations used by the workspace-changes and read-only-diff ports. */
export interface ReadOnlyGitDiffSource {
  /** Modified/added tracked paths relative to the workspace root. */
  listModifiedFiles(): readonly string[];
  /** Hunk-level diff for one path; unavailable when git fails or the path is unchanged. */
  produceDiff(filePath: string): DiffReviewOutcome;
}

const serviceModuleDirectory = dirname(fileURLToPath(import.meta.url));

/**
 * Walk up from a directory until the workspace root marker is found.
 *
 * The pnpm monorepo root is marked by pnpm-workspace.yaml. A package.json
 * alone is ambiguous (every workspace package has one), so the nearest
 * package.json is kept as a fallback only when no workspace marker exists
 * anywhere above the starting directory.
 */
function findRepositoryRoot(startDirectory: string): string {
  let current = startDirectory;
  let fallbackRoot: string | undefined;
  for (;;) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    if (fallbackRoot === undefined && existsSync(join(current, "package.json"))) {
      fallbackRoot = current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return fallbackRoot ?? current;
    }
    current = parent;
  }
}

const defaultRepositoryRoot = findRepositoryRoot(serviceModuleDirectory);

let memoizedWorkspaceRoot: string | undefined;

/**
 * The workspace root used by the default git sources.
 *
 * Reads `IDE_STORY_WORKSPACE` once and memoizes the result; defaults to the
 * repository root discovered from this module location when unset.
 */
export function resolveWorkspaceRoot(): string {
  if (memoizedWorkspaceRoot === undefined) {
    const configured = process.env[IDE_STORY_WORKSPACE_ENV];
    memoizedWorkspaceRoot =
      configured !== undefined && configured.length > 0
        ? resolve(configured)
        : defaultRepositoryRoot;
  }
  return memoizedWorkspaceRoot;
}

const GIT_TIMEOUT_MS = 5_000;
const GIT_MAX_OUTPUT_BYTES = 1024 * 1024;
const GIT_UNAVAILABLE = "Git changes are unavailable for this workspace or exceed the review limits.";

/** Bound Git I/O and suppress executable workspace filters and implicit index writes. */
function runGit(root: string, args: readonly string[], deadline: number): string {
  const timeout = deadline - Date.now();
  if (timeout <= 0) throw new Error(GIT_UNAVAILABLE);
  const env = { ...process.env };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"]) delete env[key];
  try {
    const bytes = execFileSync("git", ["--no-pager", "--no-optional-locks", "--literal-pathspecs", "-c", "core.fsmonitor=false", ...args], {
      cwd: root, env, timeout, maxBuffer: GIT_MAX_OUTPUT_BYTES, killSignal: "SIGKILL", stdio: ["ignore", "pipe", "pipe"],
    });
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch { throw new Error(GIT_UNAVAILABLE); }
}

function parsePorcelainStatusPaths(status: string, prefix: string): readonly string[] {
  if (status && !status.endsWith("\0")) throw new Error(GIT_UNAVAILABLE);
  const records = status.split("\0"); records.pop();
  const paths: string[] = [];
  for (let index = 0; index < records.length; index++) {
    const record = records[index]!;
    if (record.length < 4 || !/^[ MADRCU?!T]{2} /u.test(record)) throw new Error(GIT_UNAVAILABLE);
    const code = record.slice(0, 2);
    if (/[RC]/u.test(code) && records[++index] === undefined) throw new Error(GIT_UNAVAILABLE);
    if (!/[MA]/u.test(code) || code.includes("D")) continue;
    const path = record.slice(3);
    if (!path.startsWith(prefix)) throw new Error(GIT_UNAVAILABLE);
    const relative = path.slice(prefix.length);
    if (relative) paths.push(relative);
  }
  return paths;
}

function listModifiedFilesAt(root: string, deadline = Date.now() + GIT_TIMEOUT_MS): readonly string[] {
  const prefix = runGit(root, ["rev-parse", "--show-prefix"], deadline).replace(/\n$/u, "");
  const status = runGit(root, ["status", "--porcelain=v1", "-z", "--untracked-files=no", "--", "."], deadline);
  return parsePorcelainStatusPaths(status, prefix);
}

/** Unified diff hunk header: `@@ -oldStart[,oldLines] +newStart[,newLines] @@`. */
const UNIFIED_HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Parse the hunk headers of a unified diff; omitted counts default to 1. */
function parseUnifiedDiffHunks(diffText: string): readonly DiffHunk[] {
  const lines = diffText.split("\n");
  const hunks: DiffHunk[] = [];
  let index = 0;
  while (index < lines.length) {
    const match = UNIFIED_HUNK_HEADER.exec(lines[index]);
    if (match === null) {
      index += 1;
      continue;
    }
    const oldStart = Number(match[1]);
    const oldLines = match[2] !== undefined ? Number(match[2]) : 1;
    const newStart = Number(match[3]);
    const newLines = match[4] !== undefined ? Number(match[4]) : 1;
    const body: string[] = [];
    index += 1;
    while (index < lines.length && !UNIFIED_HUNK_HEADER.test(lines[index])) {
      body.push(lines[index]);
      index += 1;
    }
    hunks.push({ oldStart, oldLines, newStart, newLines, text: body.join("\n") });
  }
  return hunks;
}

/** Union of the new-file line ranges touched by the hunks. */
function computeDiffRange(path: string, hunks: readonly DiffHunk[]): DiffRange {
  let startLine = Number.POSITIVE_INFINITY;
  let endLine = 0;
  for (const hunk of hunks) {
    const hunkStart = Math.max(1, hunk.newStart);
    const hunkEnd = Math.max(1, hunk.newStart + Math.max(0, hunk.newLines - 1));
    if (hunkStart < startLine) {
      startLine = hunkStart;
    }
    if (hunkEnd > endLine) {
      endLine = hunkEnd;
    }
  }
  return { path, startLine, endLine };
}

function produceDiffAt(root: string, filePath: string): DiffReviewOutcome {
  const deadline = Date.now() + GIT_TIMEOUT_MS;
  try {
    if (!listModifiedFilesAt(root, deadline).includes(filePath))
      return { kind: "unavailable", reason: "The selected file has no reviewable tracked changes." };
    const diffText = runGit(root, ["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--unified=3", "--", filePath], deadline);
    const hunks = parseUnifiedDiffHunks(diffText);
    if (!hunks.length) return { kind: "unavailable", reason: "No unstaged text changes are available for this file." };
    return { kind: "ok", diff: { path: filePath, hunks, range: computeDiffRange(filePath, hunks), readOnly: true } };
  } catch { return { kind: "unavailable", reason: GIT_UNAVAILABLE }; }
}

/** Create a bounded working-tree review source; errors never imply a clean repository. */
export function createReadOnlyGitDiffSource(root: string): ReadOnlyGitDiffSource {
  return {
    listModifiedFiles(): readonly string[] {
      return listModifiedFilesAt(root);
    },
    produceDiff(filePath: string): DiffReviewOutcome {
      return produceDiffAt(root, filePath);
    },
  };
}
