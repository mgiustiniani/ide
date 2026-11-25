import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JavaDependencySourceRequest } from "@ide/contracts";
import { TauriJavaDependencySourceAdapter } from "./java-dependency-source-tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const request: JavaDependencySourceRequest = {
  workspaceId: "one",
  generation: 1,
  requestId: "source",
  document: { path: "Main.java", text: "\nclass Main {}", version: 1 },
  position: { line: 0, character: 0 },
  projectContext: {
    projectPath: "",
    sdkHome: "/jdk",
    mavenRepository: "/repository",
    activeMavenProfiles: [],
    inactiveMavenProfiles: [],
    snapshotHash: "a".repeat(64),
    contextHash: "b".repeat(64),
    platformIdentities: ["c".repeat(64)],
  },
};
function response(operation = "lookup") {
  return {
    workspaceId: "one",
    generation: 1,
    requestId: "source",
    documentPath: "Main.java",
    documentVersion: 1,
    operation,
    status: "available",
    schemaVersion: "java-dependency-source-v1",
    snapshotHash: "a".repeat(64),
    contextHash: "b".repeat(64),
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
    ...(operation === "read" ? { content: "package external; public class Library {}" } : {}),
  };
}

beforeEach(() => vi.resetAllMocks());
describe("Tauri dependency-source boundary", () => {
  it("requires the selected complete immutable editor proof and rejects saved-schema substitutions", async () => {
    const documents = [
      request.document,
      { path: "Helper.java", text: "class Helper { int draft; }", version: 44 },
    ];
    const editorRequest = {
      ...request,
      editorOverlay: { expectedOverlayHash: "9".repeat(64), documents },
      expectedAssociationHash: "d".repeat(64),
    };
    const data = {
      ...response("read"),
      schemaVersion: "java-editor-dependency-source-v1",
      editorOverlay: {
        baseSnapshotHash: request.projectContext.snapshotHash,
        providerSnapshotHash: "8".repeat(64),
        overlayHash: "9".repeat(64),
        documents: documents.map(({ path, version }) => ({
          path,
          version,
          contentSha256: "7".repeat(64),
        })),
      },
    };
    vi.mocked(invoke).mockResolvedValue(data);
    expect(await new TauriJavaDependencySourceAdapter().read(editorRequest)).toMatchObject({
      status: "available",
      editorOverlay: data.editorOverlay,
    });
    for (const changed of [
      { ...data, schemaVersion: "java-dependency-source-v1" },
      { ...data, editorOverlay: { ...data.editorOverlay, overlayHash: "0".repeat(64) } },
      {
        ...data,
        editorOverlay: {
          ...data.editorOverlay,
          documents: data.editorOverlay.documents.slice(0, 1),
        },
      },
      {
        ...data,
        editorOverlay: {
          ...data.editorOverlay,
          documents: [
            data.editorOverlay.documents[0],
            { ...data.editorOverlay.documents[1], version: 45 },
          ],
        },
      },
    ]) {
      vi.mocked(invoke).mockResolvedValue(changed);
      await expect(new TauriJavaDependencySourceAdapter().read(editorRequest)).rejects.toThrow();
    }
  });
  it("decodes a JDT declaration without inventing source contents or a workspace path", async () => {
    const data = {
      ...response("declaration"),
      schemaVersion: "java-dependency-source-declaration-v1",
      declaration: {
        nameRange: { start: { line: 2, character: 15 }, end: { line: 2, character: 19 } },
        declarationRange: { start: { line: 2, character: 1 }, end: { line: 2, character: 46 } },
        evidence: "JDT_SOURCE_BINDING",
        bindingKey: "Lexternal/Library;.call(I)Ljava/lang/String;",
      },
    };
    vi.mocked(invoke).mockResolvedValue(data);
    const result = await new TauriJavaDependencySourceAdapter().declaration(request);
    expect(result).toMatchObject({
      operation: "declaration",
      status: "available",
      declaration: data.declaration,
    });
    expect(result).not.toHaveProperty("content");
    expect(invoke).toHaveBeenCalledExactlyOnceWith("resolve_java_dependency_source_declaration", {
      request,
    });
    for (const declaration of [
      { ...data.declaration, evidence: "TOKEN_GUESS" },
      {
        ...data.declaration,
        nameRange: { ...data.declaration.nameRange, end: { line: 2, character: 99 } },
      },
    ]) {
      vi.mocked(invoke).mockResolvedValue({ ...data, declaration });
      await expect(new TauriJavaDependencySourceAdapter().declaration(request)).rejects.toThrow(
        "uncorrelated",
      );
    }
  });
  it("preserves declaration ambiguity with no selected range", async () => {
    vi.mocked(invoke).mockResolvedValue({
      ...response("declaration"),
      status: "ambiguous",
      reason: { code: "java.sources.declarationAmbiguous", message: "Multiple declarations." },
    });
    const result = await new TauriJavaDependencySourceAdapter().declaration(request);
    expect(result.status).toBe("ambiguous");
    expect(result).not.toHaveProperty("declaration");
    expect(result).not.toHaveProperty("association");
  });
  it("accepts dependency-source evidence from Java 27 and rejects unsupported later releases", async () => {
    const java27 = response();
    java27.sdkIdentities[0]!.release = 27;
    vi.mocked(invoke).mockResolvedValue(java27);
    await expect(new TauriJavaDependencySourceAdapter().lookup(request)).resolves.toMatchObject({
      status: "available",
      sdkIdentities: [{ release: 27 }],
    });

    const unsupported = response();
    unsupported.sdkIdentities[0]!.release = 28;
    vi.mocked(invoke).mockResolvedValue(unsupported);
    await expect(new TauriJavaDependencySourceAdapter().lookup(request)).rejects.toThrow(
      "Invalid or uncorrelated Java dependency source response",
    );
  });
  it("accepts an empty cursor line and invokes only the read-only lookup command", async () => {
    vi.mocked(invoke).mockResolvedValue(response());
    const result = await new TauriJavaDependencySourceAdapter().lookup(request);
    expect(result.status).toBe("available");
    expect(invoke).toHaveBeenCalledExactlyOnceWith("lookup_java_dependency_source", { request });
  });
  it.each([
    "generation",
    "requestId",
    "documentVersion",
    "contextHash",
    "snapshotHash",
    "operation",
  ])("rejects mismatched %s", async (key) => {
    vi.mocked(invoke).mockResolvedValue({ ...response(), [key]: "other" });
    await expect(new TauriJavaDependencySourceAdapter().lookup(request)).rejects.toThrow(
      "uncorrelated",
    );
  });
  it("rejects a writable response and an archive entry escaping its root", async () => {
    for (const change of [
      { readOnly: false },
      { resourceUri: "file:///tmp/Library.java" },
      { sourceEntry: "../Library.java" },
    ]) {
      const data = response();
      vi.mocked(invoke).mockResolvedValue({
        ...data,
        association: { ...data.association, ...change },
      });
      await expect(new TauriJavaDependencySourceAdapter().lookup(request)).rejects.toThrow(
        "uncorrelated",
      );
    }
  });
  it("requires the same association for a bounded UTF-8 source read", async () => {
    const read = { ...request, expectedAssociationHash: "d".repeat(64) };
    vi.mocked(invoke).mockResolvedValue(response("read"));
    expect((await new TauriJavaDependencySourceAdapter().read(read)).status).toBe("available");
    vi.mocked(invoke).mockResolvedValue({ ...response("read"), content: "😀".repeat(32769) });
    await expect(new TauriJavaDependencySourceAdapter().read(read)).rejects.toThrow("uncorrelated");
    vi.mocked(invoke).mockResolvedValue(response("read"));
    await expect(
      new TauriJavaDependencySourceAdapter().read({
        ...read,
        expectedAssociationHash: "e".repeat(64),
      }),
    ).rejects.toThrow("uncorrelated");
  });
  it("preserves an explicit unavailable provider response without inventing content", async () => {
    vi.mocked(invoke).mockResolvedValue({
      ...response(),
      status: "unavailable",
      reason: { code: "java.sources.notAttached", message: "No source attachment is present." },
    });
    const result = await new TauriJavaDependencySourceAdapter().lookup(request);
    expect(result.status).toBe("unavailable");
    expect(result).not.toHaveProperty("content");
    expect(result).not.toHaveProperty("association");
  });
  it("refuses an unsafely positioned or escaping caller request before native invocation", async () => {
    await expect(
      new TauriJavaDependencySourceAdapter().lookup({
        ...request,
        document: { ...request.document, path: "../Main.java" },
      }),
    ).rejects.toThrow();
    await expect(
      new TauriJavaDependencySourceAdapter().lookup({
        ...request,
        position: { line: 0, character: 1 },
      }),
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
});
