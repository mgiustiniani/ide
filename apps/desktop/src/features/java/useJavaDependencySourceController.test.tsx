import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  JavaDependencySourceRequest,
  JavaDependencySourceResult,
  JavaNavigationRequest,
  JavaNavigationResult,
  JavaDependencySourceDeclarationResult,
  JavaPlatformSourceAssociation,
  JavaPlatformSourceRequest,
  JavaPlatformSourceResult,
  JavaPlatformSourceDeclarationResult,
} from "@ide/contracts";
import {
  EditorViewModel,
  type EditorPort,
  type JavaDependencySourcePort,
  type JavaPlatformSourcePort,
} from "@ide/web-core";
import { createEditorStore } from "@ide/web-core/state";
import { javaProjectContextResponse } from "../../../../../tests/story/fixtures/java-project-context-response";
import { useJavaDependencySourceController } from "./useJavaDependencySourceController";

const source = "class Main { external.Library library; }";
const content = "package external; public class Library {}";
const cursor: JavaNavigationRequest = {
  workspaceId: "one",
  generation: 1,
  requestId: "cursor",
  kind: "definition",
  document: { path: "Main.java", text: source, version: 1 },
  position: { line: 0, character: 25 },
  includeDeclaration: true,
  limit: 1,
};
function sourceResult(
  request: JavaDependencySourceRequest,
  operation: "lookup" | "read",
): Extract<JavaDependencySourceResult, { status: "available" }> {
  return {
    workspaceId: request.workspaceId,
    generation: request.generation,
    requestId: request.requestId,
    documentPath: request.document.path,
    documentVersion: request.document.version,
    operation,
    status: "available",
    schemaVersion: request.editorOverlay
      ? "java-editor-dependency-source-v1"
      : "java-dependency-source-v1",
    snapshotHash: request.projectContext.snapshotHash,
    contextHash: request.projectContext.contextHash,
    ...(request.editorOverlay
      ? {
          editorOverlay: {
            baseSnapshotHash: request.projectContext.snapshotHash,
            providerSnapshotHash: "8".repeat(64),
            overlayHash: request.editorOverlay.expectedOverlayHash,
            documents: request.editorOverlay.documents
              .filter((document) => document.path.endsWith(".java"))
              .map(({ path, version }) => ({
                path,
                version,
                contentSha256: "7".repeat(64),
              })),
          },
        }
      : {}),
    sdkIdentities: [{ release: 17, sdkHome: "/jdk", identitySha256: "c".repeat(64) }],
    association: {
      associationHash: "d".repeat(64),
      resourceUri: `refactorkit-java-source://${"d".repeat(64)}/external%2FLibrary.java`,
      readOnly: true,
      providerId: "maven-effective-v1",
      moduleId: "app",
      sourceSetId: "main",
      binaryPath: "/repository/library.jar",
      binarySha256: "e".repeat(64),
      sourceArchivePath: "/repository/library-sources.jar",
      sourceArchiveSha256: "f".repeat(64),
      sourceEntry: "external/Library.java",
      sourceSha256: "1".repeat(64),
      jvmIdentity: {
        kind: "TYPE",
        ownerBinaryName: "external.Library",
        memberName: "",
        descriptor: "Lexternal/Library;",
      },
      provenance: {
        kind: "MAVEN_SELECTED_COORDINATE_AND_CLASSFILE_SOURCE_FILE",
        componentId: "external:library:1",
        sourceFile: "Library.java",
      },
    },
    ...(operation === "read" ? { content } : {}),
  };
}

const platformContent = "package java.lang; public final class String { public String() {} }";
const platformAssociation = (request: JavaPlatformSourceRequest): JavaPlatformSourceAssociation => {
  const associationHash = "9".repeat(64);
  return {
    associationHash,
    resourceUri: `refactorkit-java-platform-source://${associationHash}/java.base%2Fjava%2Flang%2FString.java`,
    readOnly: true,
    resourceKind: "java-platform-source",
    providerId: "java-platform-v1",
    moduleId: "app",
    sourceSetId: "main",
    sdkHome: "/jdk",
    effectiveRelease: 17,
    platformRelease: 17,
    platformIdentitySha256: request.expectedPlatformIdentitySha256,
    platformModule: "java.base",
    binaryOrigin: {
      kind: "CURRENT_JRT_IMAGE",
      uri: "jrt:/java.base/java/lang/String.class",
      classEntry: "java/lang/String.class",
      classSha256: "1".repeat(64),
      moduleImagePath: "/jdk/lib/modules",
      moduleImageSha256: "2".repeat(64),
    },
    sourceArchivePath: "/jdk/lib/src.zip",
    sourceArchiveSha256: "3".repeat(64),
    sourceEntry: "java.base/java/lang/String.java",
    sourceSha256: "4".repeat(64),
    sourceFile: "String.java",
    jvmIdentity: {
      kind: "TYPE",
      ownerBinaryName: "java.lang.String",
      memberName: "",
      descriptor: "Ljava/lang/String;",
    },
  };
};

function platformResult(
  request: JavaPlatformSourceRequest,
  operation: "lookup" | "read",
): JavaPlatformSourceResult {
  return {
    workspaceId: request.workspaceId,
    generation: request.generation,
    requestId: request.requestId,
    documentPath: request.document.path,
    documentVersion: request.document.version,
    operation,
    status: "available",
    schemaVersion: "java-platform-source-v1",
    snapshotHash: request.projectContext.snapshotHash,
    contextHash: request.projectContext.contextHash,
    sdkIdentities: [
      {
        release: 17,
        identitySha256: request.expectedPlatformIdentitySha256,
        sdkHome: "/jdk",
      },
    ],
    association: platformAssociation(request),
    ...(request.editorOverlay
      ? {
          editorOverlay: {
            baseSnapshotHash: request.projectContext.snapshotHash,
            providerSnapshotHash: "8".repeat(64),
            overlayHash: request.editorOverlay.expectedOverlayHash,
            documents: request.editorOverlay.documents.map(({ path, version }) => ({
              path,
              version,
              contentSha256: "7".repeat(64),
            })),
          },
        }
      : {}),
    ...(operation === "read" ? { content: platformContent } : {}),
  };
}

function declarationResult(
  request: JavaDependencySourceRequest,
): Extract<JavaDependencySourceDeclarationResult, { status: "available" }> {
  return {
    ...sourceResult(request, "lookup"),
    operation: "declaration",
    schemaVersion: request.editorOverlay
      ? "java-editor-dependency-source-declaration-v1"
      : "java-dependency-source-declaration-v1",
    declaration: {
      evidence: "JDT_SOURCE_BINDING",
      bindingKey: "Lexternal/Library;",
      nameRange: {
        start: { line: 0, character: content.indexOf("Library") },
        end: { line: 0, character: content.indexOf("Library") + 7 },
      },
      declarationRange: {
        start: { line: 0, character: 18 },
        end: { line: 0, character: content.length },
      },
    },
  };
}

function platformDeclarationResult(
  request: JavaPlatformSourceRequest,
): JavaPlatformSourceDeclarationResult {
  const name = platformContent.indexOf("String");
  return {
    ...platformResult(request, "lookup"),
    operation: "declaration",
    schemaVersion: "java-platform-source-declaration-v1",
    declaration: {
      evidence: "JDT_SOURCE_BINDING",
      bindingKey: "Ljava/lang/String;",
      nameRange: { start: { line: 0, character: name }, end: { line: 0, character: name + 6 } },
      declarationRange: {
        start: { line: 0, character: 18 },
        end: { line: 0, character: platformContent.length },
      },
    },
  } as JavaPlatformSourceDeclarationResult;
}

async function harness(
  dirtyJava = true,
  contextSchemaVersion:
    "java-project-context-v1" | "java-project-context-v2" = "java-project-context-v1",
) {
  const store = createEditorStore();
  const files: EditorPort = {
    loadContent: vi.fn(async (path) => ({
      filePath: path,
      content: path === "Main.java" ? source : "class Other {}",
      language: "java",
    })),
    getOpenFiles: vi.fn(async () => store.getState().openFiles),
    saveContent: vi.fn(),
    closeFile: vi.fn(),
  };
  const editor = new EditorViewModel(store.getState, files);
  await editor.openFile("Other.java");
  if (dirtyJava) editor.updateContent("Other.java", "class Other { int unsaved; }");
  await editor.openFile("Main.java");
  const settings = {
    projectPath: "",
    sdkHome: "/jdk",
    mavenRepository: "/repository",
    activeMavenProfiles: [],
    inactiveMavenProfiles: [],
  };
  const selected = {
    settings,
    context: {
      ...javaProjectContextResponse({
        ...settings,
        workspaceId: "one",
        generation: 1,
        requestId: "context",
      }).context,
      schemaVersion: contextSchemaVersion,
    },
  };
  const workspace = { workspaceId: "one" as string | null, generation: 1, isSwitching: false };
  const port: JavaDependencySourcePort = {
    declaration: vi.fn(async (r) => declarationResult(r)),
    lookup: vi.fn(async (r) => sourceResult(r, "lookup")),
    read: vi.fn(async (r) => sourceResult(r, "read")),
  };
  const platformPort: JavaPlatformSourcePort = {
    declaration: vi.fn(async (r: JavaPlatformSourceRequest) => ({
      workspaceId: r.workspaceId,
      generation: r.generation,
      requestId: r.requestId,
      documentPath: r.document.path,
      documentVersion: r.document.version,
      operation: "declaration" as const,
      status: "unavailable" as const,
      reason: { code: "missing", message: "JDK sources unavailable" },
    })),
    lookup: vi.fn(async (r: JavaPlatformSourceRequest) => ({
      workspaceId: r.workspaceId,
      generation: r.generation,
      requestId: r.requestId,
      documentPath: r.document.path,
      documentVersion: r.document.version,
      operation: "lookup" as const,
      status: "unavailable" as const,
      reason: { code: "missing", message: "JDK sources unavailable" },
    })),
    read: vi.fn(async (r) => ({
      workspaceId: r.workspaceId,
      generation: r.generation,
      requestId: r.requestId,
      documentPath: r.document.path,
      documentVersion: r.document.version,
      operation: "read" as const,
      status: "unavailable" as const,
      reason: { code: "missing", message: "JDK sources unavailable" },
    })),
  };
  const dependencies = {
    port,
    platformPort,
    workspaceId: workspace.workspaceId,
    generation: 1,
    getContext: () => workspace,
    getProjectContext: () => selected,
    getEditorState: store.getState,
    editor,
  };
  const hook = renderHook(() => useJavaDependencySourceController(dependencies));
  return { hook, store, editor, files, port, platformPort, selected, workspace };
}

function overlaySelection(
  h: Awaited<ReturnType<typeof harness>>,
): Extract<JavaNavigationResult, { status: "ready" }> {
  const context = h.selected.context;
  return {
    workspaceId: cursor.workspaceId,
    generation: cursor.generation,
    requestId: cursor.requestId,
    kind: "definition",
    documentPath: cursor.document.path,
    documentVersion: cursor.document.version,
    status: "ready",
    provider: {
      name: "RefactorKit",
      version: "0.7.0",
      backend: "eclipse-jdt-3.44-bindings-v1",
      evidence: "compiler",
    },
    locations: [],
    sourceFiles: [],
    items: [],
    total: 0,
    returned: 0,
    truncated: false,
    complete: true,
    warningCount: 0,
    snapshotHash: context.snapshotHash,
    sourceHash: "a".repeat(64),
    indexGeneration: 1,
    projectContext: {
      projectPath: "",
      contextHash: context.contextHash,
      contextSchemaVersion: "java-project-context-v1",
      platformIdentities: context.sdk.map((sdk) => sdk.identitySha256),
    },
    editorOverlay: {
      baseSnapshotHash: context.snapshotHash,
      providerSnapshotHash: "8".repeat(64),
      overlayHash: "9".repeat(64),
      documents: h.editor
        .captureEditorBuffers()
        .documents.filter((document) => document.path.endsWith(".java"))
        .map(({ path, version }) => ({ path, version, contentSha256: "7".repeat(64) })),
    },
  };
}

function unavailableSelection(request: JavaNavigationRequest = cursor): JavaNavigationResult {
  return {
    workspaceId: request.workspaceId,
    generation: request.generation,
    requestId: request.requestId,
    kind: request.kind,
    documentPath: request.document.path,
    documentVersion: request.document.version,
    status: "unavailable",
    message: "The workspace definition is unavailable.",
  };
}

describe("read-only dependency source documents", () => {
  it("carries the v2 project-context schema into dependency source requests", async () => {
    const h = await harness(false, "java-project-context-v2");
    await act(async () => {
      await h.hook.result.current.queryDefinition(cursor);
    });
    expect(h.port.declaration).toHaveBeenCalledWith(
      expect.objectContaining({
        projectContext: expect.objectContaining({
          contextSchemaVersion: "java-project-context-v2",
        }),
      }),
    );
  });

  it("uses an unavailable workspace definition as the saved-source declaration fallback", async () => {
    const h = await harness(false);
    let target!: Awaited<ReturnType<typeof h.hook.result.current.queryDefinition>>;
    await act(async () => {
      target = await h.hook.result.current.queryDefinition(cursor, unavailableSelection());
    });
    expect(target).not.toBeNull();
    expect(h.port.declaration).toHaveBeenCalledOnce();
    expect(vi.mocked(h.port.declaration).mock.calls[0][0]).toMatchObject({
      workspaceId: cursor.workspaceId,
      generation: cursor.generation,
      document: cursor.document,
    });
    expect(vi.mocked(h.port.declaration).mock.calls[0][0].editorOverlay).toBeUndefined();
    expect(h.files.saveContent).not.toHaveBeenCalled();
  });

  it("keeps dirty Java buffers protected when an unavailable result has no frame attestation", async () => {
    const h = await harness();
    await act(async () => {
      expect(
        await h.hook.result.current.queryDefinition(cursor, unavailableSelection()),
      ).toBeNull();
    });
    expect(h.port.declaration).not.toHaveBeenCalled();
    expect(h.store.getState().contents["Other.java"]).toContain("unsaved");
    expect(h.hook.result.current.message).toContain("current Java editor frame");
    expect(h.files.saveContent).not.toHaveBeenCalled();
  });

  it("prepares an exact definition, revalidates its attachment before opening, and selects the actual name", async () => {
    const h = await harness(false);
    let target!: Awaited<ReturnType<typeof h.hook.result.current.queryDefinition>>;
    await act(async () => {
      target = await h.hook.result.current.queryDefinition(cursor);
    });
    expect(target?.range).toEqual(
      declarationResult(vi.mocked(h.port.declaration).mock.calls[0][0]).declaration.nameRange,
    );
    expect(h.hook.result.current.activeDocument).toBeNull();
    expect(h.port.lookup).not.toHaveBeenCalled();
    await act(async () => {
      expect(await h.hook.result.current.openDefinition(cursor.requestId, target!.range)).toBe(
        true,
      );
    });
    expect(h.port.read).toHaveBeenCalledTimes(2);
    expect(h.hook.result.current.revealRequest?.selection).toEqual(target!.range);
    expect(h.hook.result.current.activeDocument?.uri).toBe(target!.resourceUri);
    expect(h.store.getState().tabs).toHaveLength(2);
    expect(h.files.saveContent).not.toHaveBeenCalled();
  });

  it("keeps a delayed hover definition independent from the explicit F12 request", async () => {
    const h = await harness(false);
    const hover = {
      ...cursor,
      requestId: "hover-definition",
      position: { line: 0, character: 1 },
    };
    const explicit = {
      ...cursor,
      requestId: "explicit-f12",
      position: { line: 0, character: 25 },
    };
    let finishHover!: (result: JavaDependencySourceDeclarationResult) => void;
    const hoverResponse = new Promise<JavaDependencySourceDeclarationResult>((resolve) => {
      finishHover = resolve;
    });
    vi.mocked(h.port.declaration).mockImplementation(async (request) =>
      request.requestId === `${hover.requestId}-source`
        ? hoverResponse
        : declarationResult(request),
    );

    let hoverTarget!: Awaited<ReturnType<typeof h.hook.result.current.queryDefinition>>;
    let explicitTarget!: Awaited<ReturnType<typeof h.hook.result.current.queryDefinition>>;
    let pendingHover!: Promise<typeof hoverTarget>;
    await act(async () => {
      pendingHover = h.hook.result.current.queryDefinition(hover);
      explicitTarget = await h.hook.result.current.queryDefinition(explicit);
    });

    expect(explicitTarget).not.toBeNull();
    const explicitRequest = vi
      .mocked(h.port.declaration)
      .mock.calls.map(([request]) => request)
      .find((request) => request.requestId === `${explicit.requestId}-source`);
    expect(explicitRequest?.position).toEqual(explicit.position);

    await act(async () => {
      const hoverRequest = vi
        .mocked(h.port.declaration)
        .mock.calls.map(([request]) => request)
        .find((request) => request.requestId === `${hover.requestId}-source`)!;
      finishHover(declarationResult(hoverRequest));
      hoverTarget = await pendingHover;
    });

    expect(hoverTarget).not.toBeNull();
    await act(async () => {
      expect(
        await h.hook.result.current.openDefinition(explicit.requestId, explicitTarget!.range),
      ).toBe(true);
    });
    expect(h.hook.result.current.activeDocument?.content).toBe(content);
  });

  it("refuses Java drafts without a selected immutable frame and preserves them", async () => {
    const h = await harness();
    await act(async () => {
      expect(await h.hook.result.current.queryDefinition(cursor)).toBeNull();
    });
    expect(h.port.declaration).not.toHaveBeenCalled();
    expect(h.store.getState().contents["Other.java"]).toContain("unsaved");
    expect(h.hook.result.current.message).toContain("current Java editor frame");
  });
  it("reads a selected immutable frame including dirty cursor and companion without saving", async () => {
    const h = await harness();
    h.editor.updateContent("Main.java", "// draft\n" + source);
    const selectedCursor = {
      ...cursor,
      document: { ...cursor.document, text: "// draft\n" + source },
      position: { line: 1, character: cursor.position.character },
    };
    const selection = overlaySelection(h);
    let target!: Awaited<ReturnType<typeof h.hook.result.current.queryDefinition>>;
    await act(async () => {
      target = await h.hook.result.current.queryDefinition(selectedCursor, selection);
    });
    expect(target).not.toBeNull();
    const declaration = vi.mocked(h.port.declaration).mock.calls[0][0];
    expect(declaration.editorOverlay?.documents).toHaveLength(2);
    expect(
      declaration.editorOverlay?.documents.find((document) => document.path === "Other.java")?.text,
    ).toContain("unsaved");
    await act(async () => {
      expect(await h.hook.result.current.openDefinition(cursor.requestId, target!.range)).toBe(
        true,
      );
    });
    for (const [read] of vi.mocked(h.port.read).mock.calls)
      expect(read.editorOverlay).toEqual(declaration.editorOverlay);
    expect(h.store.getState().contents["Main.java"]).toBe(selectedCursor.document.text);
    expect(h.store.getState().contents["Other.java"]).toContain("unsaved");
    expect(h.files.saveContent).not.toHaveBeenCalled();
  });
  it("rejects a missing companion or a version changed after definition selection", async () => {
    const h = await harness();
    const incomplete = overlaySelection(h);
    incomplete.editorOverlay!.documents.pop();
    await act(async () => {
      expect(await h.hook.result.current.queryDefinition(cursor, incomplete)).toBeNull();
    });
    const selected = overlaySelection(h);
    h.editor.updateContent("Other.java", "class Other { int changed; }");
    await act(async () => {
      expect(await h.hook.result.current.queryDefinition(cursor, selected)).toBeNull();
    });
    expect(h.port.declaration).not.toHaveBeenCalled();
    expect(h.files.saveContent).not.toHaveBeenCalled();
  });
  it("rejects a declaration beyond its guarded source content", async () => {
    const h = await harness(false);
    vi.mocked(h.port.declaration).mockImplementation(async (r) => {
      const result = declarationResult(r);
      result.declaration.nameRange.end.character = 999;
      return result;
    });
    await act(async () => {
      expect(await h.hook.result.current.queryDefinition(cursor)).toBeNull();
    });
    expect(h.hook.result.current.message).toContain("guarded source content");
  });
  it("refuses an attachment replaced after its exact preview was prepared", async () => {
    const h = await harness(false);
    let target!: Awaited<ReturnType<typeof h.hook.result.current.queryDefinition>>;
    await act(async () => {
      target = await h.hook.result.current.queryDefinition(cursor);
    });
    vi.mocked(h.port.read).mockImplementation(async (r) => ({
      ...sourceResult(r, "read"),
      status: "refused",
      reason: { code: "java.sources.associationStale", message: "The source archive changed." },
    }));
    await act(async () => {
      expect(await h.hook.result.current.openDefinition(cursor.requestId, target!.range)).toBe(
        false,
      );
    });
    expect(h.hook.result.current.activeDocument).toBeNull();
    expect(h.hook.result.current.message).toBe("The source archive changed.");
  });
  it("revokes an approved definition when the SDK or source buffer changes before opening", async () => {
    for (const change of ["sdk", "buffer"]) {
      const h = await harness(false);
      let target!: Awaited<ReturnType<typeof h.hook.result.current.queryDefinition>>;
      await act(async () => {
        target = await h.hook.result.current.queryDefinition(cursor);
      });
      if (change === "sdk") h.selected.settings.sdkHome = "/other-jdk";
      else h.editor.updateContent("Main.java", `${source}\n// draft`);
      await act(async () => {
        expect(await h.hook.result.current.openDefinition(cursor.requestId, target!.range)).toBe(
          false,
        );
      });
      expect(h.port.read).toHaveBeenCalledTimes(1);
      expect(h.hook.result.current.activeDocument).toBeNull();
    }
  });
  it("opens a guarded immutable document from a complete editor frame while retaining drafts", async () => {
    const h = await harness();
    await act(() => h.hook.result.current.openAtCursor(cursor, overlaySelection(h)));
    expect(h.hook.result.current.activeDocument?.content).toBe(content);
    expect(h.store.getState().tabs).toHaveLength(2);
    expect(h.store.getState().contents["Other.java"]).toContain("unsaved");
    expect(h.store.getState().tabs.find((tab) => tab.filePath === "Other.java")?.isDirty).toBe(
      true,
    );
    expect(h.files.saveContent).not.toHaveBeenCalled();
    expect(h.port.read).toHaveBeenCalledWith(
      expect.objectContaining({ expectedAssociationHash: "d".repeat(64) }),
    );
    expect(h.port.lookup).toHaveBeenCalledWith(
      expect.objectContaining({
        editorOverlay: {
          expectedOverlayHash: "9".repeat(64),
          documents: expect.arrayContaining([
            expect.objectContaining({ path: "Other.java", text: "class Other { int unsaved; }" }),
          ]),
        },
      }),
    );
    act(() => h.hook.result.current.close(h.hook.result.current.activeDocument!.uri));
    expect(h.hook.result.current.activeDocument).toBeNull();
    expect(h.store.getState().activeFilePath).toBe("Main.java");
  });

  it("opens an owning source from the selected dirty cursor and companion without exact-declaration lookup", async () => {
    const h = await harness();
    h.editor.updateContent("Main.java", "// draft\n" + source);
    const selectedCursor = {
      ...cursor,
      document: { ...cursor.document, text: "// draft\n" + source },
      position: { line: 1, character: 25 },
    };
    await act(() => h.hook.result.current.openAtCursor(selectedCursor, overlaySelection(h)));
    expect(h.hook.result.current.activeDocument?.content).toBe(content);
    const lookup = vi.mocked(h.port.lookup).mock.calls[0][0];
    expect(lookup.editorOverlay?.documents).toHaveLength(2);
    expect(
      lookup.editorOverlay?.documents.find((document) => document.path === "Main.java")?.text,
    ).toBe(selectedCursor.document.text);
    expect(vi.mocked(h.port.read).mock.calls[0][0].editorOverlay).toEqual(lookup.editorOverlay);
    expect(h.port.declaration).not.toHaveBeenCalled();
    expect(h.files.saveContent).not.toHaveBeenCalled();
  });

  it("refuses an owning source when the selected frame is unavailable or omits a companion", async () => {
    const h = await harness();
    const missing = overlaySelection(h);
    missing.editorOverlay!.documents.pop();
    await act(() => h.hook.result.current.openAtCursor(cursor, missing));
    await act(() =>
      h.hook.result.current.openAtCursor(cursor, {
        ...overlaySelection(h),
        status: "unavailable",
        message: "Editor binding is unavailable.",
      }),
    );
    expect(h.hook.result.current.activeDocument).toBeNull();
    expect(h.hook.result.current.message).toContain("Editor binding is unavailable.");
    expect(h.port.lookup).not.toHaveBeenCalled();
    expect(h.files.saveContent).not.toHaveBeenCalled();
  });

  it("uses the saved-source route when only a non-Java draft is open", async () => {
    const h = await harness(false);
    await h.editor.openFile("notes.txt");
    h.editor.updateContent("notes.txt", "keep this draft");
    await h.editor.openFile("Main.java");
    await act(() => h.hook.result.current.openAtCursor(cursor));
    expect(h.hook.result.current.activeDocument?.content).toBe(content);
    expect(vi.mocked(h.port.lookup).mock.calls[0][0].editorOverlay).toBeUndefined();
    expect(h.store.getState().contents["notes.txt"]).toBe("keep this draft");
    expect(h.files.saveContent).not.toHaveBeenCalled();
  });

  it("refuses a dirty cursor file without saving any draft or calling the provider", async () => {
    const h = await harness();
    h.editor.updateContent("Main.java", `${source}\n// draft`);
    await act(() =>
      h.hook.result.current.openAtCursor({
        ...cursor,
        document: { ...cursor.document, text: `${source}\n// draft` },
      }),
    );
    expect(h.hook.result.current.message).toContain("editor frame is unavailable");
    expect(h.port.lookup).not.toHaveBeenCalled();
    expect(h.files.saveContent).not.toHaveBeenCalled();
  });

  it("keeps an explicit owning-source read current when Monaco requests a background definition", async () => {
    const h = await harness(false);
    await act(async () => {
      await h.hook.result.current.queryDefinition(cursor);
    });
    vi.mocked(h.port.declaration).mockClear();
    vi.mocked(h.port.read).mockClear();
    vi.mocked(h.port.lookup).mockImplementation(async (request) => {
      h.hook.result.current.cancelDefinition(cursor.requestId);
      expect(
        await h.hook.result.current.queryDefinition({
          ...cursor,
          requestId: "hover",
          position: { line: 0, character: 1 },
        }),
      ).toBeNull();
      return sourceResult(request, "lookup");
    });
    await act(() => h.hook.result.current.openAtCursor(cursor));
    expect(h.hook.result.current.activeDocument?.content).toBe(content);
    expect(h.port.read).toHaveBeenCalledTimes(1);
    expect(h.port.declaration).not.toHaveBeenCalled();
    expect(h.files.saveContent).not.toHaveBeenCalled();
  });

  it.each(["sdk", "workspace", "edit", "companion", "selection", "closed"])(
    "rejects a delayed read after %s changes",
    async (change) => {
      const h = await harness(false);
      let finish!: (value: JavaDependencySourceResult) => void;
      let request!: JavaDependencySourceRequest;
      vi.mocked(h.port.read).mockImplementation((r) => {
        request = r;
        return new Promise((resolve) => {
          finish = resolve;
        });
      });
      let pending!: Promise<void>;
      await act(async () => {
        pending = h.hook.result.current.openAtCursor(cursor);
        await Promise.resolve();
      });
      expect(finish).toBeTypeOf("function");
      if (change === "sdk") h.selected.settings.sdkHome = "/other-sdk";
      if (change === "workspace") h.workspace.generation += 1;
      if (change === "edit") h.editor.updateContent("Main.java", `${source}\n// changed`);
      if (change === "companion")
        h.editor.updateContent("Other.java", "class Other { int changed; }");
      if (change === "selection") act(() => h.hook.result.current.showWorkspace());
      if (change === "closed") await h.editor.closeFile("Main.java");
      await act(async () => {
        h.hook.rerender();
        finish(sourceResult(request, "read"));
        await pending;
      });
      expect(h.hook.result.current.activeDocument).toBeNull();
      expect(h.hook.result.current.documents).toEqual([]);
      expect(h.files.saveContent).not.toHaveBeenCalled();
    },
  );

  it("refuses attachments changed between lookup and read", async () => {
    const h = await harness(false);
    vi.mocked(h.port.read).mockImplementation(async (r) => {
      const result = sourceResult(r, "read");
      result.association.sourceArchiveSha256 = "2".repeat(64);
      return result;
    });
    await act(() => h.hook.result.current.openAtCursor(cursor));
    expect(h.hook.result.current.activeDocument).toBeNull();
    expect(h.hook.result.current.message).toContain("attachment changed");
  });

  it("retires previously opened library tabs when context authority changes", async () => {
    const h = await harness(false);
    await act(() => h.hook.result.current.openAtCursor(cursor));
    h.selected.context.contextHash = "9".repeat(64);
    act(() => h.hook.rerender());
    expect(h.hook.result.current.documents).toEqual([]);
    expect(h.store.getState().contents["Other.java"]).toBe("class Other {}");
  });

  it("resolves and opens exact SDK declarations after dependency lookup is unavailable", async () => {
    const h = await harness(false);
    h.selected.context.sdk[0]!.platformRelease = 17;
    vi.spyOn(h.port, "declaration").mockImplementation(async (request) => ({
      workspaceId: request.workspaceId,
      generation: request.generation,
      requestId: request.requestId,
      documentPath: request.document.path,
      documentVersion: request.document.version,
      operation: "declaration",
      status: "unavailable",
      reason: { code: "not-in-workspace", message: "No attached library source." },
    }));
    vi.spyOn(h.platformPort, "declaration").mockImplementation(async (request) =>
      platformDeclarationResult(request),
    );
    vi.spyOn(h.platformPort, "read").mockImplementation(async (request) =>
      platformResult(request, "read"),
    );

    await act(async () => {
      await h.hook.result.current.queryDefinition(cursor);
    });
    expect(h.platformPort.declaration).toHaveBeenCalledOnce();

    const nameStart = platformContent.indexOf("String");
    await act(async () => {
      expect(
        await h.hook.result.current.openDefinition(cursor.requestId, {
          start: { line: 0, character: nameStart },
          end: { line: 0, character: nameStart + "String".length },
        }),
      ).toBe(true);
    });
    expect(h.hook.result.current.activeDocument?.association).toMatchObject({
      resourceKind: "java-platform-source",
      platformModule: "java.base",
      sourceEntry: "java.base/java/lang/String.java",
    });
    expect(h.hook.result.current.activeDocument?.content).toBe(platformContent);
    h.hook.unmount();
  });

  it("binds SDK declarations to the complete dirty Java editor frame without saving drafts", async () => {
    const h = await harness(true);
    h.selected.context.sdk[0]!.platformRelease = 17;
    const selection = overlaySelection(h);
    vi.spyOn(h.port, "declaration").mockImplementation(async (request) => ({
      workspaceId: request.workspaceId,
      generation: request.generation,
      requestId: request.requestId,
      documentPath: request.document.path,
      documentVersion: request.document.version,
      operation: "declaration",
      status: "unavailable",
      reason: { code: "not-in-workspace", message: "No attached library source." },
    }));
    const platformDeclaration = vi
      .spyOn(h.platformPort, "declaration")
      .mockImplementation(async (request) => platformDeclarationResult(request));
    const platformRead = vi
      .spyOn(h.platformPort, "read")
      .mockImplementation(async (request) => platformResult(request, "read"));

    await act(async () => {
      await h.hook.result.current.queryDefinition(cursor, selection);
    });

    const expectedOverlay = selection.editorOverlay!;
    const declarationRequest = platformDeclaration.mock.calls[0]?.[0];
    expect(declarationRequest?.editorOverlay).toMatchObject({
      expectedOverlayHash: expectedOverlay.overlayHash,
      documents: expect.arrayContaining([
        expect.objectContaining({ path: "Main.java", text: source }),
        expect.objectContaining({ path: "Other.java", text: "class Other { int unsaved; }" }),
      ]),
    });
    expect(declarationRequest?.editorOverlay?.documents).toHaveLength(2);

    const nameStart = platformContent.indexOf("String");
    await act(async () => {
      expect(
        await h.hook.result.current.openDefinition(cursor.requestId, {
          start: { line: 0, character: nameStart },
          end: { line: 0, character: nameStart + "String".length },
        }),
      ).toBe(true);
    });

    expect(platformRead.mock.calls[0]?.[0].editorOverlay).toEqual(
      declarationRequest?.editorOverlay,
    );
    expect(h.hook.result.current.activeDocument?.uri).toMatch(
      /^refactorkit-java-platform-source:\/\//,
    );
    expect(h.store.getState().contents["Other.java"]).toBe("class Other { int unsaved; }");
    expect(h.store.getState().tabs.find((tab) => tab.filePath === "Other.java")?.isDirty).toBe(
      true,
    );
    expect(h.files.saveContent).not.toHaveBeenCalled();
    h.hook.unmount();
  });

  it("opens SDK sources from the explicit source action and retains them as read-only tabs", async () => {
    const h = await harness(false);
    h.selected.context.sdk[0]!.platformRelease = 17;
    vi.spyOn(h.port, "lookup").mockImplementation(async (request) => ({
      workspaceId: request.workspaceId,
      generation: request.generation,
      requestId: request.requestId,
      documentPath: request.document.path,
      documentVersion: request.document.version,
      operation: "lookup",
      status: "unavailable",
      reason: { code: "not-in-workspace", message: "No attached library source." },
    }));
    vi.spyOn(h.platformPort, "lookup").mockImplementation(async (request) =>
      platformResult(request, "lookup"),
    );
    vi.spyOn(h.platformPort, "read").mockImplementation(async (request) =>
      platformResult(request, "read"),
    );

    await act(async () => {
      await h.hook.result.current.openAtCursor(cursor);
    });
    expect(h.hook.result.current.activeDocument?.uri).toMatch(
      /^refactorkit-java-platform-source:\/\//,
    );
    expect(h.hook.result.current.activeDocument?.content).toBe(platformContent);
    expect(h.hook.result.current.busy).toBe(false);
    h.hook.unmount();
  });
});

describe("retained dependency preview navigation", () => {
  it("selects a retained preview at a saved cursor without rereading or saving source", async () => {
    const h = await harness(false);
    await act(async () => { await h.hook.result.current.openAtCursor(cursor); });
    const uri = h.hook.result.current.documents[0]!.uri;
    const reads = vi.mocked(h.port.read).mock.calls.length;
    act(() => { expect(h.hook.result.current.select(uri, { lineNumber: 3, column: 8 })).toBe(true); });
    expect(h.hook.result.current.revealRequest).toMatchObject({ filePath: uri, line: 3, column: 8 });
    expect(h.port.read).toHaveBeenCalledTimes(reads);
    expect(h.files.saveContent).not.toHaveBeenCalled();
    act(() => h.hook.result.current.close(uri));
    act(() => { expect(h.hook.result.current.select(uri)).toBe(false); });
  });
  it("refuses an old preview before rendering catches a workspace generation change", async () => {
    const h = await harness(false);
    await act(async () => { await h.hook.result.current.openAtCursor(cursor); });
    const uri = h.hook.result.current.documents[0]!.uri;
    h.workspace.generation += 1;
    act(() => { expect(h.hook.result.current.select(uri)).toBe(false); });
    expect(h.files.saveContent).not.toHaveBeenCalled();
  });
});
