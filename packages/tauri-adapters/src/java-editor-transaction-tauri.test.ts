import { createHash } from "node:crypto";
import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";
import type { JavaEditorTransactionRequest } from "@ide/contracts";
import {
  invokeJavaEditorTransaction,
  javaEditorTransactionWire,
  normalizeJavaEditorTransaction,
} from "./java-editor-transaction-tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const id = "12345678-1234-1234-1234-123456789abc";
function fixture() {
  const request: JavaEditorTransactionRequest = {
    workspaceId: "workspace",
    generation: 1,
    phase: "prepare",
    planId: "reviewed",
    approvedPlanHash: "d".repeat(64),
    projectContext: {
      projectPath: "project",
      sdkHome: "/jdk",
      mavenRepository: "",
      activeMavenProfiles: [],
      inactiveMavenProfiles: [],
      snapshotHash: "a".repeat(64),
      contextHash: "b".repeat(64),
      platformIdentities: ["c".repeat(64)],
    },
    documents: [{ path: "project/A.java", text: "dirty original", version: 2 }],
  };
  const response = {
    kind: "transaction",
    workspaceId: request.workspaceId,
    generation: 1,
    phase: request.phase,
    transaction: {
      transactionId: id,
      planId: request.planId,
      approvedPlanHash: request.approvedPlanHash,
      baseSnapshotHash: request.projectContext.snapshotHash,
      contextHash: request.projectContext.contextHash,
      platformIdentities: request.projectContext.platformIdentities,
      durableRecoveryAvailable: true,
      status: "prepared",
      sourceAuthority: {
        baseSnapshotHash: request.projectContext.snapshotHash,
        overlayHash: "e".repeat(64),
        documents: [
          {
            path: "project/A.java",
            version: 2,
            contentSha256: createHash("sha256").update("dirty original").digest("hex"),
          },
        ],
      },
      workspaceEdit: {
        documentChanges: [
          {
            kind: "edit",
            path: "project/A.java",
            version: 2,
            edits: [
              {
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
                newText: "transformed",
              },
            ],
          },
        ],
      },
    },
  };
  return { request, response };
}

describe("Java editor transaction transport admission", () => {
  it("binds a workspace formatter profile only to approved prepare and confirm phases", () => {
    const { request } = fixture();
    request.formatterProfile = { path: "config/team.xml", profileName: "Team" };
    request.formatterProfileSha256 = "e".repeat(64);

    expect(javaEditorTransactionWire(request)).toMatchObject({
      formatterProfile: request.formatterProfile,
      formatterProfileSha256: "e".repeat(64),
    });

    request.phase = "confirm";
    request.transactionId = id;
    expect(javaEditorTransactionWire(request)).toMatchObject({
      formatterProfile: request.formatterProfile,
      formatterProfileSha256: "e".repeat(64),
    });

    Reflect.set(request, "phase", "undo");
    expect(() => javaEditorTransactionWire(request)).toThrow("Invalid or stale");
    request.phase = "prepare";
    request.formatterProfileSha256 = "invalid";
    expect(() => javaEditorTransactionWire(request)).toThrow("Invalid or stale");
  });

  it("accepts byte-attested proposals and freezes the request and decoded edit", async () => {
    const { request, response } = fixture();
    const captured = javaEditorTransactionWire(request);
    request.documents[0].text = "later";
    expect(captured.documents[0].text).toBe("dirty original");
    expect(Object.isFrozen(captured.documents[0])).toBe(true);
    const result = await normalizeJavaEditorTransaction(response, captured);
    expect(result.kind).toBe("transaction");
    if (result.kind === "transaction")
      expect(Object.isFrozen(result.transaction.workspaceEdit!.documentChanges[0])).toBe(true);
  });

  it.each(["workspace", "generation", "phase", "plan", "SDK", "version", "text", "path"])(
    "rejects changed %s authority",
    async (change) => {
      const { request, response } = fixture();
      if (change === "workspace") response.workspaceId = "another";
      if (change === "generation") response.generation++;
      if (change === "phase") response.phase = "confirm";
      if (change === "plan") response.transaction.approvedPlanHash = "f".repeat(64);
      if (change === "SDK") response.transaction.platformIdentities = ["f".repeat(64)];
      if (change === "version") response.transaction.sourceAuthority.documents[0].version++;
      if (change === "text")
        response.transaction.sourceAuthority.documents[0].contentSha256 = "f".repeat(64);
      if (change === "path")
        response.transaction.workspaceEdit.documentChanges[0].path = "other/A.java";
      await expect(normalizeJavaEditorTransaction(response, request)).rejects.toThrow(
        "Invalid or stale",
      );
    },
  );

  it("captures caller-owned text before native IPC and checks the returned original bytes", async () => {
    const { request, response } = fixture();
    let resolve!: (value: unknown) => void;
    vi.mocked(invoke).mockImplementationOnce(
      () =>
        new Promise((complete) => {
          resolve = complete;
        }),
    );
    const pending = invokeJavaEditorTransaction(request);
    request.documents[0].text = "caller mutation";
    resolve(response);
    await expect(pending).resolves.toMatchObject({
      kind: "transaction",
      transaction: { status: "prepared" },
    });
    expect(vi.mocked(invoke).mock.calls.at(-1)?.[0]).toBe("refactorkit_java_editor_transaction");
  });

  it("exposes a recovery refusal without edits and refuses recovery that proposes overwriting unknown state", async () => {
    const { request, response } = fixture();
    request.phase = "recover";
    request.transactionId = id;
    const raw = {
      ...response,
      phase: "recover",
      transaction: {
        ...response.transaction,
        status: "recovery-required",
        workspaceEdit: undefined as typeof response.transaction.workspaceEdit | undefined,
        refusalCode: "editor.changed",
      },
    };
    await expect(normalizeJavaEditorTransaction(raw, request)).resolves.toMatchObject({
      kind: "transaction",
      transaction: { refusalCode: "editor.changed" },
    });
    raw.transaction.workspaceEdit = response.transaction.workspaceEdit;
    await expect(normalizeJavaEditorTransaction(raw, request)).rejects.toThrow();
  });

  it("discovers original transaction authority but never treats discovery as an edit grant", async () => {
    const { request, response } = fixture();
    request.phase = "transactions";
    request.documents = [];
    const entry = {
      ...response.transaction,
      workspaceEdit: undefined,
      sdkHome: "/original-jdk",
      revalidationRequired: true,
      documents: [
        {
          originalPath: "project/A.java",
          finalPath: "project/Renamed.java",
          originalSavedContentSha256: "e".repeat(64),
        },
      ],
    };
    const raw = {
      workspaceId: request.workspaceId,
      generation: 1,
      phase: "transactions",
      kind: "discovery",
      transactions: [entry],
    };
    await expect(normalizeJavaEditorTransaction(raw, request)).resolves.toMatchObject({
      kind: "discovery",
      transactions: [
        { sdkHome: "/original-jdk", revalidationRequired: true, documents: entry.documents },
      ],
    });
    for (const documents of [
      [],
      [entry.documents[0], entry.documents[0]],
      [{ ...entry.documents[0], finalPath: "outside/B.java" }],
      [{ ...entry.documents[0], originalSavedContentSha256: "unknown" }],
    ]) {
      await expect(
        normalizeJavaEditorTransaction(
          { ...raw, transactions: [{ ...entry, documents }] },
          request,
        ),
      ).rejects.toThrow();
    }
    raw.transactions.push(entry);
    await expect(normalizeJavaEditorTransaction(raw, request)).rejects.toThrow();
  });

  it("requires correlated saved-byte revisions for file renames", async () => {
    const { request } = fixture();
    request.phase = "apply-files";
    request.transactionId = id;
    const raw = {
      workspaceId: request.workspaceId,
      generation: 1,
      phase: request.phase,
      kind: "files-applied",
      transactionId: id,
      diskSources: [
        { oldPath: "project/A.java", path: "project/B.java", revision: "f".repeat(64) },
      ],
    };
    await expect(normalizeJavaEditorTransaction(raw, request)).resolves.toMatchObject({
      kind: "files-applied",
    });
    raw.diskSources[0].revision = "unknown";
    await expect(normalizeJavaEditorTransaction(raw, request)).rejects.toThrow();
  });

  it("rejects traversal, missing approvals and invalid versions before native IPC", () => {
    const { request } = fixture();
    request.documents[0].path = "project/../A.java";
    expect(() => javaEditorTransactionWire(request)).toThrow();
    request.documents[0].path = "project/A.java";
    request.approvedPlanHash = undefined;
    expect(() => javaEditorTransactionWire(request)).toThrow();
    request.approvedPlanHash = "d".repeat(64);
    request.documents[0].version = 0;
    expect(() => javaEditorTransactionWire(request)).toThrow();
  });
});
