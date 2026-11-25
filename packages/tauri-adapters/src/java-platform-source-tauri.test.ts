import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JavaPlatformSourceRequest } from "@ide/contracts";
import {
  normalizeJavaPlatformSource,
  TauriJavaPlatformSourceAdapter,
} from "./java-platform-source-tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const request: JavaPlatformSourceRequest = {
  workspaceId: "one",
  generation: 1,
  requestId: "platform",
  document: { path: "Main.java", text: "class Main { String value; }", version: 1 },
  position: { line: 0, character: 14 },
  expectedPlatformIdentitySha256: "c".repeat(64),
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
function response(operation: "lookup" | "read" | "declaration" = "lookup") {
  return {
    workspaceId: "one",
    generation: 1,
    requestId: "platform",
    documentPath: "Main.java",
    documentVersion: 1,
    operation,
    status: "available",
    schemaVersion:
      operation === "declaration"
        ? "java-platform-source-declaration-v1"
        : "java-platform-source-v1",
    snapshotHash: "a".repeat(64),
    contextHash: "b".repeat(64),
    sdkIdentities: [{ release: 25, sdkHome: "/jdk", identitySha256: "c".repeat(64) }],
    sourceAuthority: { kind: "saved-snapshot", baseSnapshotHash: "a".repeat(64) },
    association: {
      associationHash: "d".repeat(64),
      resourceUri: `refactorkit-java-platform-source://${"d".repeat(64)}/java.base/java/lang/String.java`,
      readOnly: true,
      resourceKind: "java-platform-source",
      providerId: "maven-effective-v1",
      moduleId: "project",
      sourceSetId: "main",
      sdkHome: "/jdk",
      effectiveRelease: 25,
      platformRelease: 25,
      platformIdentitySha256: "c".repeat(64),
      platformModule: "java.base",
      binaryOrigin: {
        kind: "CURRENT_JRT_IMAGE",
        uri: "jrt:/java.base/java/lang/String.class",
        classEntry: "java/lang/String.class",
        classSha256: "e".repeat(64),
        moduleImagePath: "/jdk/lib/modules",
        moduleImageSha256: "f".repeat(64),
      },
      sourceArchivePath: "/jdk/lib/src.zip",
      sourceArchiveSha256: "1".repeat(64),
      sourceEntry: "java.base/java/lang/String.java",
      sourceSha256: "2".repeat(64),
      sourceFile: "String.java",
      jvmIdentity: {
        kind: "TYPE",
        ownerBinaryName: "java.lang.String",
        memberName: "",
        descriptor: "Ljava/lang/String;",
      },
    },
    ...(operation === "read" ? { content: "public final class String {}" } : {}),
    ...(operation === "declaration"
      ? {
          declaration: {
            evidence: "JDT_SOURCE_BINDING",
            bindingKey: "Ljava/lang/String;",
            nameRange: { start: { line: 1, character: 19 }, end: { line: 1, character: 25 } },
            declarationRange: { start: { line: 0, character: 0 }, end: { line: 10, character: 1 } },
          },
        }
      : {}),
  };
}
beforeEach(() => vi.mocked(invoke).mockReset());

describe("selected SDK source adapter", () => {
  it("carries the selected platform identity separately from the shared native cursor request", async () => {
    vi.mocked(invoke).mockResolvedValue(response());
    const result = await new TauriJavaPlatformSourceAdapter().lookup(request);
    expect(result.status).toBe("available");
    expect(invoke).toHaveBeenCalledWith("lookup_java_platform_source", {
      request: expect.not.objectContaining({ expectedPlatformIdentitySha256: expect.anything() }),
      expectedPlatformIdentitySha256: "c".repeat(64),
    });
  });
  it("decodes a source declaration with its exact JDT name range", async () => {
    vi.mocked(invoke).mockResolvedValue(response("declaration"));
    const result = await new TauriJavaPlatformSourceAdapter().declaration(request);
    expect(result.status === "available" && result.declaration.nameRange).toEqual({
      start: { line: 1, character: 19 },
      end: { line: 1, character: 25 },
    });
  });
  it("accepts platform source evidence from Java 27 and rejects unsupported later releases", async () => {
    const java27 = response();
    java27.sdkIdentities[0]!.release = 27;
    java27.association.effectiveRelease = 27;
    java27.association.platformRelease = 27;
    vi.mocked(invoke).mockResolvedValue(java27);
    await expect(new TauriJavaPlatformSourceAdapter().lookup(request)).resolves.toMatchObject({
      status: "available",
      sdkIdentities: [{ release: 27 }],
    });

    const unsupported = response();
    unsupported.sdkIdentities[0]!.release = 28;
    unsupported.association.effectiveRelease = 28;
    unsupported.association.platformRelease = 28;
    vi.mocked(invoke).mockResolvedValue(unsupported);
    await expect(new TauriJavaPlatformSourceAdapter().lookup(request)).rejects.toThrow(
      "invalid provider contract",
    );
  });
  it("reads beyond the dependency budget and enforces the separate UTF-8 SDK limit", () => {
    const read = { ...request, expectedAssociationHash: "d".repeat(64) },
      raw = response("read");
    raw.content = "é".repeat(262144);
    expect(normalizeJavaPlatformSource(raw, read, "read").status).toBe("available");
    raw.content += "é";
    expect(() => normalizeJavaPlatformSource(raw, read, "read")).toThrow(
      "invalid provider contract",
    );
  });
  it.each(["platform", "context", "release", "module", "class", "source", "uri", "binding"])(
    "rejects substituted %s evidence",
    (change) => {
      const raw = response();
      if (change === "platform") raw.association.platformIdentitySha256 = "3".repeat(64);
      if (change === "context") raw.contextHash = "3".repeat(64);
      if (change === "release") raw.association.effectiveRelease = 17;
      if (change === "module") raw.association.platformModule = "java.sql";
      if (change === "class") raw.association.binaryOrigin.classEntry = "java/lang/Object.class";
      if (change === "source") raw.association.sourceEntry = "java.base/java/lang/Object.java";
      if (change === "uri")
        raw.association.resourceUri = raw.association.resourceUri.replace("java.base", "java.sql");
      if (change === "binding") raw.association.jvmIdentity.ownerBinaryName = "java.lang.Object";
      expect(() => normalizeJavaPlatformSource(raw, request, "lookup")).toThrow(
        "invalid provider contract",
      );
    },
  );
  it("refuses a changed association before reading or selecting a declaration", () => {
    const read = { ...request, expectedAssociationHash: "3".repeat(64) };
    expect(() => normalizeJavaPlatformSource(response("read"), read, "read")).toThrow();
    expect(() =>
      normalizeJavaPlatformSource(response("declaration"), read, "declaration"),
    ).toThrow();
  });
  it("retains a complete selected editor frame and refuses saved-source substitution", () => {
    const selected = {
      ...request,
      editorOverlay: {
        expectedOverlayHash: "4".repeat(64),
        documents: [
          { path: "Main.java", text: request.document.text, version: 11 },
          { path: "Helper.java", text: "class Helper { int draft; }", version: 12 },
        ],
      },
    };
    const raw = {
      ...response(),
      providerSnapshotHash: "5".repeat(64),
      sourceAuthority: {
        kind: "immutable-editor-overlay",
        baseSnapshotHash: request.projectContext.snapshotHash,
        overlayHash: "4".repeat(64),
        documents: selected.editorOverlay.documents.map(({ path, version }) => ({
          path,
          version,
          contentSha256: "6".repeat(64),
        })),
      },
    };
    const result = normalizeJavaPlatformSource(raw, selected, "lookup");
    expect(result.status === "available" && result.editorOverlay?.documents).toHaveLength(2);
    expect(() => normalizeJavaPlatformSource(response(), selected, "lookup")).toThrow();
    raw.sourceAuthority.documents.pop();
    expect(() => normalizeJavaPlatformSource(raw, selected, "lookup")).toThrow();
  });
  it("preserves missing-source and ambiguity results without inventing an association", () => {
    for (const status of ["unavailable", "ambiguous"]) {
      const { association: _, ...raw } = response();
      const result = normalizeJavaPlatformSource(
        {
          ...raw,
          status,
          reason: {
            code: `java.platformSources.${status}`,
            message: "No qualified SDK source is available.",
          },
        },
        request,
        "lookup",
      );
      expect(result.status).toBe(status);
      expect(result).not.toHaveProperty("association");
    }
    expect(() =>
      normalizeJavaPlatformSource(
        {
          ...response(),
          status: "ambiguous",
          reason: {
            code: "java.platformSources.binaryOriginAmbiguous",
            message: "More than one owner.",
          },
        },
        request,
        "lookup",
      ),
    ).toThrow();
  });
  it("rejects an unselected platform before invoking native code", async () => {
    await expect(
      new TauriJavaPlatformSourceAdapter().lookup({
        ...request,
        expectedPlatformIdentitySha256: "3".repeat(64),
      }),
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
});
