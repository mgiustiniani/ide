import { createHash } from "node:crypto";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JavaEditorDiagnosticsRequest } from "@ide/contracts";
import {
  normalizeJavaEditorDiagnostics,
  TauriJavaEditorDiagnosticsAdapter,
} from "./java-editor-diagnostics-tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const document = {
  path: "Main.java",
  text: 'class Main { String s = "😀"; Missing x; }',
  version: 7,
};
const request: JavaEditorDiagnosticsRequest = {
  workspaceId: "workspace",
  generation: 4,
  requestId: "java-errors",
  document,
  editorOverlay: {
    documents: [document, { path: "Helper.java", text: "class Helper {}", version: 2 }],
  },
  limit: 500,
  projectContext: {
    projectPath: "",
    sdkHome: "/jdk",
    mavenRepository: "",
    activeMavenProfiles: [],
    inactiveMavenProfiles: [],
    snapshotHash: "a".repeat(64),
    contextHash: "b".repeat(64),
    contextSchemaVersion: "java-project-context-v2",
    platformIdentities: ["c".repeat(64)],
  },
};
function ready(r = request) {
  return {
    workspaceId: r.workspaceId,
    generation: r.generation,
    requestId: r.requestId,
    documentPath: r.document.path,
    documentVersion: r.document.version,
    kind: "diagnostics",
    status: "ready",
    coverage: "compiler-errors",
    complete: true,
    total: 1,
    analyzedSourceCount: 2,
    snapshotHash: r.projectContext.snapshotHash,
    indexGeneration: 2,
    projectContext: {
      projectPath: r.projectContext.projectPath,
      contextHash: r.projectContext.contextHash,
      contextSchemaVersion: r.projectContext.contextSchemaVersion,
      platformIdentities: r.projectContext.platformIdentities,
    },
    provider: {
      name: "RefactorKit",
      version: "0.7.0",
      backend: "eclipse-jdt-3.44-bindings-v1",
      evidence: "compiler",
    },
    editorOverlay: {
      baseSnapshotHash: r.projectContext.snapshotHash,
      providerSnapshotHash: "d".repeat(64),
      overlayHash: "e".repeat(64),
      documents: r.editorOverlay.documents.map((d) => ({
        path: d.path,
        version: d.version,
        contentSha256: createHash("sha256").update(d.text).digest("hex"),
      })),
    },
    sourceFiles: [
      {
        path: r.document.path,
        text: r.document.text,
        contentSha256: createHash("sha256").update(r.document.text).digest("hex"),
      },
    ],
    items: [
      {
        severity: "error",
        code: "java.jdt.typeResolution",
        message: "Missing cannot be resolved to a type",
        location: {
          path: "Main.java",
          range: { start: { line: 0, character: 29 }, end: { line: 0, character: 36 } },
        },
      },
    ],
  };
}
beforeEach(() => vi.mocked(invoke).mockReset());
describe("Java editor compiler diagnostics bridge", () => {
  it.each([1, 2, 3, 4, 5, 6, 7])("admits the single SDK26 backend only under v7: v%s", async (version) => {
    const input = { ...request, projectContext: { ...request.projectContext,
      contextSchemaVersion: `java-project-context-v${version}` as JavaEditorDiagnosticsRequest["projectContext"]["contextSchemaVersion"] } };
    const value = ready(input);
    value.items[0].code = "java.javac.compiler.err.cant.resolve.location";
    const response = { ...value, provider: { ...value.provider, id: "java-sdk-compiler-diagnostics-v1", backend: "jdk26-javac-compiler-errors-v1" } };
    if (version === 7) expect(await normalizeJavaEditorDiagnostics(response, input)).toMatchObject({ provider: { backend: "jdk26-javac-compiler-errors-v1" } });
    else await expect(normalizeJavaEditorDiagnostics(response, input)).rejects.toThrow();
    if (version === 7) {
      await expect(normalizeJavaEditorDiagnostics({ ...response, provider: { ...response.provider,
        id: "java-sdk-and-jdt-compiler-diagnostics-v1", backend: "jdk26-javac-compiler-errors-v1+eclipse-jdt-3.44-bindings-v1" } }, input)).rejects.toThrow();
      value.items[0].code = "java.jdt.typeResolution";
      await expect(normalizeJavaEditorDiagnostics({ ...response, items: value.items }, input)).rejects.toThrow();
    }
  });
  it.each([
    ["java-sdk-compiler-diagnostics-v1", "jdk25-javac-compiler-errors-v1"],
    ["java-sdk-and-jdt-compiler-diagnostics-v1", "jdk25-javac-compiler-errors-v1+eclipse-jdt-3.44-bindings-v1"],
  ])("preserves the attested compiler identity %s", async (id, backend) => {
    const value = ready();
    value.items[0].code = "java.javac.compiler.err.cant.resolve.location";
    const input = { ...value, provider: { ...value.provider, id, backend } };
    expect(await normalizeJavaEditorDiagnostics(input, request)).toMatchObject({
      provider: { id, backend, evidence: "compiler" },
      items: [{ code: "java.javac.compiler.err.cant.resolve.location" }],
    });
  });
  it.each([
    [undefined, "jdk25-javac-compiler-errors-v1", "java.javac.compiler.err.cant.resolve"],
    ["java-jdt-bindings-v1", "jdk25-javac-compiler-errors-v1", "java.javac.compiler.err.cant.resolve"],
    ["java-sdk-compiler-diagnostics-v1", "eclipse-jdt-3.44-bindings-v1", "java.jdt.typeResolution"],
    ["java-sdk-and-jdt-compiler-diagnostics-v1", "jdk25-javac-compiler-errors-v1", "java.javac.compiler.err.cant.resolve"],
    ["unknown-compiler", "jdk25-javac-compiler-errors-v1", "java.javac.compiler.err.cant.resolve"],
    ["java-sdk-compiler-diagnostics-v1", "jdk25-javac-compiler-errors-v1", "java.jdt.typeResolution"],
    ["java-sdk-compiler-diagnostics-v1", "jdk25-javac-compiler-errors-v1", "java.javac.compiler.warn.unused"],
  ])("rejects mixed or unsupported compiler provenance %s / %s / %s", async (id, backend, code) => {
    const value = ready();
    value.items[0].code = code!;
    await expect(normalizeJavaEditorDiagnostics({ ...value, provider: { ...value.provider, id, backend } }, request)).rejects.toThrow();
  });
  it("refuses an analyzed-source count beyond the provider schema limit", async () => {
    await expect(normalizeJavaEditorDiagnostics({ ...ready(), analyzedSourceCount: 10001 }, request)).rejects.toThrow();
  });
  it("refuses SDK compiler claims under the legacy context schema", async () => {
    const legacy = { ...request, projectContext: { ...request.projectContext, contextSchemaVersion: "java-project-context-v1" as const } };
    const value = ready(legacy);
    value.items[0].code = "java.javac.compiler.err.cant.resolve";
    await expect(normalizeJavaEditorDiagnostics({ ...value, provider: { ...value.provider,
      id: "java-sdk-compiler-diagnostics-v1", backend: "jdk25-javac-compiler-errors-v1" } }, legacy)).rejects.toThrow();
  });
  it("publishes errors and permits a fully attested empty result", async () => {
    const result = await normalizeJavaEditorDiagnostics(ready(), request);
    expect(result).toMatchObject({
      status: "ready",
      total: 1,
      coverage: "compiler-errors",
      analyzedSourceCount: 2,
    });
    const empty = ready();
    empty.items = [];
    empty.sourceFiles = [];
    empty.total = 0;
    expect(await normalizeJavaEditorDiagnostics(empty, request)).toMatchObject({
      status: "ready",
      items: [],
      complete: true,
    });
  });
  it("accepts errors in saved closed sources without treating them as editor buffers", async () => {
    const r = structuredClone(request);
    r.editorOverlay.documents = [r.document];
    const d = ready(r),
      saved = "class Helper {}";
    d.sourceFiles = [
      {
        path: "Helper.java",
        text: saved,
        contentSha256: createHash("sha256").update(saved).digest("hex"),
      },
    ];
    d.items[0].location = {
      path: "Helper.java",
      range: { start: { line: 0, character: 6 }, end: { line: 0, character: 12 } },
    };
    expect(await normalizeJavaEditorDiagnostics(d, r)).toMatchObject({
      status: "ready",
      analyzedSourceCount: 2,
      items: [{ location: { path: "Helper.java" } }],
    });
    d.sourceFiles[0].contentSha256 = "f".repeat(64);
    await expect(normalizeJavaEditorDiagnostics(d, r)).rejects.toThrow();
  });
  it("rejects changed document bytes even when the version is unchanged", async () => {
    const changed = structuredClone(request);
    changed.editorOverlay.documents[1].text += "\n";
    await expect(normalizeJavaEditorDiagnostics(ready(), changed)).rejects.toThrow();
  });
  it("rejects mismatched context, missing companion evidence and incomplete analysis", async () => {
    const mutations: ((d: ReturnType<typeof ready>) => void)[] = [
      (d) => {
        d.requestId = "other";
      },
      (d) => {
        d.projectContext.contextHash = "f".repeat(64);
      },
      (d) => {
        d.projectContext.platformIdentities = [];
      },
      (d) => {
        d.complete = false;
      },
      (d) => {
        d.analyzedSourceCount = 1;
      },
      (d) => {
        d.editorOverlay.documents.pop();
      },
      (d) => {
        d.editorOverlay.documents[1].version++;
      },
      (d) => {
        d.total = 0;
      },
      (d) => {
        d.items[0].location.path = "Closed.java";
      },
      (d) => {
        d.items[0].severity = "warning";
      },
      (d) => {
        d.items[0].location.range.start.character = 26;
      }, // splits the emoji surrogate pair
    ];
    for (const mutate of mutations) {
      const d = ready();
      mutate(d);
      await expect(normalizeJavaEditorDiagnostics(d, request)).rejects.toThrow();
    }
  });
  it("keeps a refusal distinct from an empty error list", async () => {
    const refusal = {
      workspaceId: request.workspaceId,
      generation: request.generation,
      requestId: request.requestId,
      kind: "diagnostics",
      documentPath: document.path,
      documentVersion: document.version,
      status: "unavailable",
      message: "Provider capability unavailable",
    };
    expect(await normalizeJavaEditorDiagnostics(refusal, request)).toMatchObject({
      status: "unavailable",
    });
    await expect(
      normalizeJavaEditorDiagnostics({ ...refusal, items: [] }, request),
    ).rejects.toThrow();
    expect(
      await normalizeJavaEditorDiagnostics(
        {
          ...refusal,
          status: "refused",
          refusalCode: "java.context.sourceRootProvenanceIncomplete",
          message: "Compiler diagnostics require complete captured source-root provenance",
        },
        request,
      ),
    ).toMatchObject({
      status: "refused",
      refusalCode: "java.context.sourceRootProvenanceIncomplete",
      message:
        "Java compiler checks are unavailable because RefactorKit has not supplied verified source folder information.",
    });
  });
  it("captures request bytes, cancels the live request and rejects duplicate request IDs", async () => {
    let resolve!: (v: unknown) => void;
    vi.mocked(invoke).mockImplementation((command) =>
      command === "query_refactorkit_java_editor_diagnostics"
        ? new Promise((r) => {
            resolve = r;
          })
        : Promise.resolve(undefined),
    );
    const adapter = new TauriJavaEditorDiagnosticsAdapter(),
      input = structuredClone(request);
    const result = adapter.query(input);
    input.document.text += "changed";
    await expect(adapter.query(request)).rejects.toThrow();
    await adapter.cancel(request.requestId);
    expect(invoke).toHaveBeenCalledWith("cancel_refactorkit_java_navigation_query", {
      context: { workspaceId: "workspace", generation: 4 },
      requestId: request.requestId,
    });
    resolve(ready());
    expect(await result).toMatchObject({ status: "ready" });
    vi.mocked(invoke).mockClear();
    await adapter.cancel(request.requestId);
    expect(invoke).not.toHaveBeenCalled();
  });
  it("refuses malformed inventories before invoking native code", async () => {
    const adapter = new TauriJavaEditorDiagnosticsAdapter();
    for (const change of [
      (r: JavaEditorDiagnosticsRequest) => {
        r.editorOverlay.documents.push(r.document);
      },
      (r: JavaEditorDiagnosticsRequest) => {
        r.limit = 501;
      },
      (r: JavaEditorDiagnosticsRequest) => {
        r.editorOverlay.documents[0] = {
          ...r.editorOverlay.documents[0],
          version: r.document.version + 1,
        };
      },
    ]) {
      const r = structuredClone(request);
      change(r);
      await expect(adapter.query(r)).rejects.toThrow();
    }
    expect(invoke).not.toHaveBeenCalled();
  });
});
