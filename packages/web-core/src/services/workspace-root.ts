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

/** Run a read-only git command; throws when git is missing or the command fails. */
function runGit(root: string, args: readonly string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Parse `git status --porcelain=v1` output into modified/added tracked paths.
 *
 * Only paths whose status columns contain M (modified) or A (added) are kept;
 * untracked (??) and deleted (D) paths are excluded because they are not
 * diffable through the read-only `git diff -- <path>` delegation.
 */
function parsePorcelainStatusPaths(status: string): readonly string[] {
  const paths: string[] = [];
  for (const rawLine of status.split("\n")) {
    const line = rawLine.trimEnd();
    if (line.length < 3) {
      continue;
    }
    const statusColumns = line.slice(0, 2);
    if (!/[MA]/.test(statusColumns)) {
      continue;
    }
    let path = line.slice(3).trim();
    const renameSeparator = path.indexOf(" -> ");
    if (renameSeparator !== -1) {
      path = path.slice(renameSeparator + 4).trim();
    }
    if (path.length > 0) {
      paths.push(path);
    }
  }
  return paths;
}

function listModifiedFilesAt(root: string): readonly string[] {
  let status: string;
  try {
    status = runGit(root, ["status", "--porcelain=v1"]);
  } catch {
    // git absent, or the workspace is not a git repository: no modified files.
    return [];
  }
  return parsePorcelainStatusPaths(status);
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
    const hunkStart = hunk.newStart;
    const hunkEnd = hunk.newStart + hunk.newLines - 1;
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
  // extract: only modified/added tracked paths are reviewable
  const modifiedPaths = listModifiedFilesAt(root);
  if (!modifiedPaths.includes(filePath)) {
    return {
      kind: "unavailable",
      reason: `not a modified working-tree file: ${filePath}`,
    };
  }

  // delegate: read-only git diff for one path
  let diffText: string;
  try {
    diffText = runGit(root, ["diff", "--no-ext-diff", "--unified=3", "--", filePath]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      kind: "unavailable",
      reason: `git diff failed for ${filePath}: ${detail}`,
    };
  }

  // response: hunk-level diff with line-range metadata
  const hunks = parseUnifiedDiffHunks(diffText);
  if (hunks.length === 0) {
    return {
      kind: "unavailable",
      reason: `git diff produced no hunk-level changes for ${filePath}`,
    };
  }

  return {
    kind: "ok",
    diff: {
      path: filePath,
      hunks,
      range: computeDiffRange(filePath, hunks),
      readOnly: true,
    },
  };
}

/**
 * Create a read-only git diff-review source rooted at `root`.
 *
 * All git commands run with `cwd: root` and never mutate the working tree:
 * only `git status --porcelain` and `git diff --no-ext-diff --unified=3` are
 * used, both of which are strictly read-only.
 */
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
