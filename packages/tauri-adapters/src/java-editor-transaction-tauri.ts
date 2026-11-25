import type {
  JavaEditorTransaction,
  JavaEditorTransactionRequest,
  JavaEditorTransactionResult,
  JavaEditorWorkspaceEdit,
} from "@ide/contracts";
import { isJavaProjectOperationContext } from "@ide/contracts";
import { isNormalizedWorkspaceRelativePath } from "@ide/web-core/editor-open-coordinator";
import { invokeTauri } from "./errors";

const INVALID = "Invalid or stale Java editor transaction; inspect recovery before retrying.";
const phases = [
  "prepare",
  "confirm",
  "undo.prepare",
  "undo.confirm",
  "recover",
  "transactions",
  "apply-files",
];
const statuses = ["prepared", "applied", "undo-prepared", "undone", "aborted", "recovery-required"];
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
function record(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(INVALID);
  return v as Record<string, unknown>;
}
function text(v: unknown, max = 256): string {
  if (typeof v !== "string" || !v || v.length > max || v.includes("\0")) throw new Error(INVALID);
  return v;
}
function scopedPath(v: unknown, request: JavaEditorTransactionRequest): string {
  const path = text(v, 4096);
  const prefix = request.projectContext.projectPath ? `${request.projectContext.projectPath}/` : "";
  if (
    !isNormalizedWorkspaceRelativePath(path) ||
    !path.startsWith(prefix) ||
    !path.endsWith(".java")
  )
    throw new Error(INVALID);
  return path;
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** Capture a bounded request before invoking native code, including its original SDK authority. */
export function javaEditorTransactionWire(
  request: JavaEditorTransactionRequest,
): JavaEditorTransactionRequest {
  if (
    !request ||
    !phases.includes(request.phase) ||
    !isJavaProjectOperationContext(request.projectContext) ||
    !Number.isSafeInteger(request.generation) ||
    request.generation <= 0
  )
    throw new Error(INVALID);
  text(request.workspaceId);
  if (request.phase !== "transactions" && !hash(request.approvedPlanHash)) throw new Error(INVALID);
  const hasFormatterProfile = request.formatterProfile !== undefined;
  const hasFormatterProfileSha256 = request.formatterProfileSha256 !== undefined;
  if (hasFormatterProfile !== hasFormatterProfileSha256) throw new Error(INVALID);
  if (hasFormatterProfile) {
    const profile = request.formatterProfile!;
    if (
      !["prepare", "confirm"].includes(request.phase) ||
      !isNormalizedWorkspaceRelativePath(profile.path) ||
      !profile.path.toLowerCase().endsWith(".xml") ||
      typeof profile.profileName !== "string" ||
      !profile.profileName.trim() ||
      profile.profileName.trim() !== profile.profileName ||
      profile.profileName.length > 256 ||
      /[\u0000-\u001f\u007f]/.test(profile.profileName) ||
      !hash(request.formatterProfileSha256)
    )
      throw new Error(INVALID);
  }
  if (
    !hasFormatterProfile &&
    !["prepare", "confirm"].includes(request.phase) &&
    hasFormatterProfileSha256
  )
    throw new Error(INVALID);
  if (request.planId !== undefined) text(request.planId);
  if (request.phase === "prepare" && !request.planId) throw new Error(INVALID);
  if (request.transactionId !== undefined && !uuid(request.transactionId)) throw new Error(INVALID);
  if (!["prepare", "transactions"].includes(request.phase) && !request.transactionId)
    throw new Error(INVALID);
  if (
    !Array.isArray(request.documents) ||
    request.documents.length > 128 ||
    (request.phase !== "transactions" && !request.documents.length)
  )
    throw new Error(INVALID);
  const paths = new Set<string>();
  let bytes = 0;
  for (const document of request.documents) {
    const path = scopedPath(document.path, request);
    if (
      paths.has(path) ||
      !Number.isSafeInteger(document.version) ||
      document.version <= 0 ||
      document.version > 2147483647 ||
      typeof document.text !== "string"
    )
      throw new Error(INVALID);
    paths.add(path);
    const size = new TextEncoder().encode(document.text).length;
    bytes += size;
    if (size > 1024 * 1024 || bytes > 8 * 1024 * 1024) throw new Error(INVALID);
  }
  return freeze(structuredClone(request));
}

function workspaceEdit(
  value: unknown,
  request: JavaEditorTransactionRequest,
): JavaEditorWorkspaceEdit {
  const changes = record(value).documentChanges;
  if (!Array.isArray(changes) || changes.length > 1024) throw new Error(INVALID);
  const point = (v: unknown) => {
    const p = record(v);
    if (![p.line, p.character].every((n) => Number.isSafeInteger(n) && (n as number) >= 0))
      throw new Error(INVALID);
    return { line: p.line as number, character: p.character as number };
  };
  return {
    documentChanges: changes.map((value) => {
      const c = record(value);
      if (c.kind === "rename") {
        const oldPath = scopedPath(c.oldPath, request),
          path = scopedPath(c.path, request);
        if (oldPath === path) throw new Error(INVALID);
        return { kind: "rename" as const, oldPath, path };
      }
      if (
        c.kind !== "edit" ||
        !Number.isSafeInteger(c.version) ||
        (c.version as number) <= 0 ||
        (c.version as number) > 2147483647 ||
        !Array.isArray(c.edits) ||
        c.edits.length > 4096
      )
        throw new Error(INVALID);
      return {
        kind: "edit" as const,
        path: scopedPath(c.path, request),
        version: c.version as number,
        edits: c.edits.map((value) => {
          const e = record(value),
            range = record(e.range);
          if (
            typeof e.newText !== "string" ||
            new TextEncoder().encode(e.newText).length > 8 * 1024 * 1024
          )
            throw new Error(INVALID);
          return {
            range: { start: point(range.start), end: point(range.end) },
            newText: e.newText,
          };
        }),
      };
    }),
  };
}

function transaction(
  value: unknown,
  discovery: boolean,
  request: JavaEditorTransactionRequest,
): JavaEditorTransaction {
  const r = record(value);
  if (
    !uuid(r.transactionId) ||
    !statuses.includes(r.status as string) ||
    r.durableRecoveryAvailable !== true ||
    ![r.approvedPlanHash, r.baseSnapshotHash, r.contextHash].every(hash)
  )
    throw new Error(INVALID);
  const result: JavaEditorTransaction = {
    transactionId: r.transactionId,
    planId: text(r.planId),
    approvedPlanHash: r.approvedPlanHash as string,
    baseSnapshotHash: r.baseSnapshotHash as string,
    contextHash: r.contextHash as string,
    status: r.status as JavaEditorTransaction["status"],
    durableRecoveryAvailable: true,
  };
  if (discovery) {
    result.sdkHome = text(r.sdkHome, 4096);
    if (typeof r.revalidationRequired !== "boolean" || r.workspaceEdit !== undefined)
      throw new Error(INVALID);
    result.revalidationRequired = r.revalidationRequired;
    if (r.documents !== undefined) {
      if (!Array.isArray(r.documents) || !r.documents.length || r.documents.length > 128)
        throw new Error(INVALID);
      const originalPaths = new Set<string>(),
        finalPaths = new Set<string>();
      result.documents = r.documents.map((value) => {
        const d = record(value),
          originalPath = scopedPath(d.originalPath, request),
          finalPath = scopedPath(d.finalPath, request);
        if (
          !hash(d.originalSavedContentSha256) ||
          originalPaths.has(originalPath) ||
          finalPaths.has(finalPath)
        )
          throw new Error(INVALID);
        originalPaths.add(originalPath);
        finalPaths.add(finalPath);
        return {
          originalPath,
          finalPath,
          originalSavedContentSha256: d.originalSavedContentSha256,
        };
      });
    }
  }
  return result;
}

/** Decode only native-correlated outcomes; prepared edits must attest every captured byte and version. */
export async function normalizeJavaEditorTransaction(
  value: unknown,
  request: JavaEditorTransactionRequest,
): Promise<JavaEditorTransactionResult> {
  const r = record(value);
  if (
    r.workspaceId !== request.workspaceId ||
    r.generation !== request.generation ||
    r.phase !== request.phase
  )
    throw new Error(INVALID);
  if (request.phase === "transactions") {
    if (r.kind !== "discovery" || !Array.isArray(r.transactions) || r.transactions.length > 16)
      throw new Error(INVALID);
    const transactions = r.transactions.map((v) => transaction(v, true, request));
    if (new Set(transactions.map((t) => t.transactionId)).size !== transactions.length)
      throw new Error(INVALID);
    return freeze({ kind: "discovery", transactions });
  }
  if (request.phase === "apply-files") {
    if (
      r.kind !== "files-applied" ||
      r.transactionId !== request.transactionId ||
      !Array.isArray(r.diskSources) ||
      r.diskSources.length > 128
    )
      throw new Error(INVALID);
    const oldPaths = new Set<string>(),
      paths = new Set<string>();
    const diskSources = r.diskSources.map((value) => {
      const d = record(value),
        oldPath = scopedPath(d.oldPath, request),
        path = scopedPath(d.path, request);
      if (
        !hash(d.revision) ||
        oldPath === path ||
        oldPaths.has(oldPath) ||
        paths.has(path) ||
        !request.documents.some((d) => d.path === oldPath)
      )
        throw new Error(INVALID);
      oldPaths.add(oldPath);
      paths.add(path);
      return { oldPath, path, revision: d.revision };
    });
    return freeze({ kind: "files-applied", transactionId: request.transactionId!, diskSources });
  }
  if (r.kind !== "transaction") throw new Error(INVALID);
  const raw = record(r.transaction),
    t = transaction(raw, false, request);
  if (
    t.approvedPlanHash !== request.approvedPlanHash ||
    t.baseSnapshotHash !== request.projectContext.snapshotHash ||
    t.contextHash !== request.projectContext.contextHash ||
    (request.planId !== undefined && t.planId !== request.planId) ||
    (request.transactionId !== undefined && t.transactionId !== request.transactionId) ||
    !Array.isArray(raw.platformIdentities) ||
    JSON.stringify(raw.platformIdentities) !==
      JSON.stringify(request.projectContext.platformIdentities)
  )
    throw new Error(INVALID);
  t.platformIdentities = [...request.projectContext.platformIdentities];
  if (t.status === "recovery-required") {
    if (raw.workspaceEdit !== undefined) throw new Error(INVALID);
    t.refusalCode = text(raw.refusalCode);
  } else if (["prepared", "undo-prepared"].includes(t.status)) {
    const authority = record(raw.sourceAuthority);
    if (
      !hash(authority.baseSnapshotHash) ||
      !hash(authority.overlayHash) ||
      !Array.isArray(authority.documents) ||
      authority.documents.length !== request.documents.length ||
      (request.phase === "prepare" &&
        authority.baseSnapshotHash !== request.projectContext.snapshotHash)
    )
      throw new Error(INVALID);
    const paths = new Set<string>();
    const documents = await Promise.all(
      authority.documents.map(async (value) => {
        const d = record(value),
          path = scopedPath(d.path, request),
          captured = request.documents.find((d) => d.path === path);
        if (
          !captured ||
          paths.has(path) ||
          d.version !== captured.version ||
          !hash(d.contentSha256)
        )
          throw new Error(INVALID);
        paths.add(path);
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(captured.text),
        );
        const expected = Array.from(new Uint8Array(digest), (n) =>
          n.toString(16).padStart(2, "0"),
        ).join("");
        if (d.contentSha256 !== expected) throw new Error(INVALID);
        return { path, version: captured.version, contentSha256: expected };
      }),
    );
    t.sourceAuthority = {
      baseSnapshotHash: authority.baseSnapshotHash,
      overlayHash: authority.overlayHash,
      documents,
    };
    t.workspaceEdit = workspaceEdit(raw.workspaceEdit, request);
  } else if (raw.workspaceEdit !== undefined) throw new Error(INVALID);
  return freeze({ kind: "transaction", transaction: t });
}

export async function invokeJavaEditorTransaction(
  request: JavaEditorTransactionRequest,
): Promise<JavaEditorTransactionResult> {
  const captured = javaEditorTransactionWire(request);
  return normalizeJavaEditorTransaction(
    await invokeTauri("refactorkit_java_editor_transaction", { request: captured }),
    captured,
  );
}
