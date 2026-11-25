import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JavaNavigationRequest } from "@ide/contracts";
import { BrowserJavaNavigationAdapter } from "../../browser-adapters/src/java-navigation-browser";
import { normalizeJavaNavigation, TauriJavaNavigationAdapter } from "./java-navigation-tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const request: JavaNavigationRequest = {
  workspaceId: "workspace",
  generation: 4,
  requestId: "java-test",
  kind: "definition",
  document: { path: "Main.java", text: 'class Main { String s = "😀"; }', version: 7 },
  position: { line: 0, character: 6 },
  includeDeclaration: true,
  limit: 1,
};
function ready(query = request) {
  return {
    workspaceId: query.workspaceId,
    generation: query.generation,
    requestId: query.requestId,
    kind: query.kind,
    documentPath: query.document.path,
    documentVersion: query.document.version,
    status: "ready",
    snapshotHash: "a".repeat(64),
    sourceHash: "b".repeat(64),
    indexGeneration: 3,
    total: 1,
    returned: 1,
    items: [],
    complete: true,
    truncated: false,
    warningCount: 0,
    provider: {
      name: "RefactorKit",
      version: "0.7.0",
      backend: "eclipse-jdt-3.44-bindings-v1",
      evidence: "compiler",
    },
    sourceFiles: [{ path: "Helper.java", text: '"😀" Helper' }],
    locations: [
      {
        path: "Helper.java",
        range: { start: { line: 0, character: 5 }, end: { line: 0, character: 11 } },
      },
    ],
  };
}
beforeEach(() => vi.mocked(invoke).mockReset());

describe("saved-source Java navigation adapter", () => {
  it("preserves bounded typed provider refusal codes", () => {
    const message = "Java source analysis is unqualified for this context.";
    const refusal = {
      ...ready(),
      status: "refused",
      message,
      refusalCode: "java.context.sourceAnalysisUnqualified",
    };
    expect(normalizeJavaNavigation(refusal, request)).toMatchObject({
      status: "refused",
      message,
      refusalCode: "java.context.sourceAnalysisUnqualified",
    });
    expect(() =>
      normalizeJavaNavigation({ ...refusal, refusalCode: "java.context/sourceAnalysis" }, request),
    ).toThrow("Invalid or uncorrelated");
  });

  it("preserves an explicit project-context retirement only for an SDK-bound query", () => {
    const selected: JavaNavigationRequest = {
      ...request,
      projectContext: {
        projectPath: "",
        sdkHome: "/jdk",
        mavenRepository: "/maven",
        activeMavenProfiles: [],
        inactiveMavenProfiles: [],
        snapshotHash: "a".repeat(64),
        contextHash: "c".repeat(64),
        platformIdentities: ["d".repeat(64)],
      },
    };
    const message = "The project session was retired; synchronize the Java project and retry.";
    const retired = {
      ...ready(selected),
      status: "refused",
      message,
      projectContextRetired: true,
    };

    expect(normalizeJavaNavigation(retired, selected)).toMatchObject({
      status: "refused",
      projectContextRetired: true,
      message,
    });
    expect(() =>
      normalizeJavaNavigation({ ...retired, projectContextRetired: false }, selected),
    ).toThrow("Invalid or uncorrelated");
    expect(() => normalizeJavaNavigation(retired, request)).toThrow("Invalid or uncorrelated");
  });

  it("decodes immutable Java document evidence and rejects stale versions, source text and hashes", () => {
    const selected: JavaNavigationRequest = {
      ...request,
      projectContext: {
        projectPath: "",
        sdkHome: "/jdk",
        mavenRepository: "/maven",
        activeMavenProfiles: [],
        inactiveMavenProfiles: [],
        snapshotHash: "a".repeat(64),
        contextHash: "c".repeat(64),
        platformIdentities: ["d".repeat(64)],
      },
      editorOverlay: {
        documents: [
          { ...request.document },
          { path: "Helper.java", text: '"😀" Helper', version: 3 },
        ],
      },
    };
    const result = {
      ...ready(selected),
      projectContext: {
        projectPath: "",
        contextHash: "c".repeat(64),
        contextSchemaVersion: "java-project-context-v1",
        platformIdentities: ["d".repeat(64)],
      },
      editorOverlay: {
        baseSnapshotHash: "a".repeat(64),
        providerSnapshotHash: "e".repeat(64),
        overlayHash: "f".repeat(64),
        documents: selected.editorOverlay!.documents.map((document) => ({
          path: document.path,
          version: document.version,
          contentSha256: "b".repeat(64),
        })),
      },
    };
    expect(normalizeJavaNavigation(result, selected)).toMatchObject({
      status: "ready",
      editorOverlay: result.editorOverlay,
    });
    const stale = structuredClone(result);
    stale.editorOverlay.documents[0].version--;
    expect(() => normalizeJavaNavigation(stale, selected)).toThrow("Invalid or uncorrelated");
    const missing = { ...result, editorOverlay: undefined };
    expect(() => normalizeJavaNavigation(missing, selected)).toThrow("Invalid or uncorrelated");
    const changed = structuredClone(result);
    changed.sourceFiles[0].text = '"😀" Wrong';
    expect(() => normalizeJavaNavigation(changed, selected)).toThrow("Invalid or uncorrelated");
    const malformed = structuredClone(result);
    malformed.editorOverlay.overlayHash = "invalid";
    expect(() => normalizeJavaNavigation(malformed, selected)).toThrow("Invalid or uncorrelated");
  });

  it("refuses editor overlays without explicit SDK authority before invoking native code", async () => {
    await expect(
      new TauriJavaNavigationAdapter().query({
        ...request,
        editorOverlay: { documents: [request.document] },
      }),
    ).rejects.toThrow("Invalid immutable");
    expect(invoke).not.toHaveBeenCalled();
  });
  it("requires exact saved-project and SDK attestation when a configured context is supplied", async () => {
    const selected = {
      ...request,
      projectContext: {
        projectPath: "",
        sdkHome: "/jdk",
        mavenRepository: "/maven",
        activeMavenProfiles: ["alternate"],
        inactiveMavenProfiles: [],
        snapshotHash: "a".repeat(64),
        contextHash: "c".repeat(64),
        platformIdentities: ["d".repeat(64)],
      },
    };
    const attestation = {
      projectPath: "",
      contextHash: "c".repeat(64),
      contextSchemaVersion: "java-project-context-v1",
      platformIdentities: ["d".repeat(64)],
    };
    const value = { ...ready(selected), projectContext: attestation };
    vi.mocked(invoke).mockResolvedValueOnce(value);
    expect(await new TauriJavaNavigationAdapter().query(selected)).toMatchObject({
      projectContext: attestation,
    });
    expect(invoke).toHaveBeenCalledWith("query_refactorkit_java_navigation", { request: selected });
    const selectedV2 = {
      ...selected,
      projectContext: {
        ...selected.projectContext,
        contextSchemaVersion: "java-project-context-v2" as const,
      },
    };
    const attestationV2 = {
      ...attestation,
      contextSchemaVersion: "java-project-context-v2",
    };
    vi.mocked(invoke).mockResolvedValueOnce({
      ...ready(selectedV2),
      projectContext: attestationV2,
    });
    expect(await new TauriJavaNavigationAdapter().query(selectedV2)).toMatchObject({
      projectContext: attestationV2,
    });
    for (const change of [
      { contextHash: "e".repeat(64) },
      { contextSchemaVersion: "other" },
      { platformIdentities: ["e".repeat(64)] },
      { projectPath: "other" },
    ])
      expect(() =>
        normalizeJavaNavigation(
          { ...value, projectContext: { ...attestation, ...change } },
          selected,
        ),
      ).toThrow();
    expect(() => normalizeJavaNavigation(ready(selected), selected)).toThrow();
    await expect(
      new TauriJavaNavigationAdapter().query({
        ...selected,
        projectContext: { ...selected.projectContext, projectPath: "../escape" },
      }),
    ).rejects.toThrow();
  });
  it("forwards cancellation for a pending request to its exact native workspace context", async () => {
    let finishQuery!: (value: unknown) => void;
    vi.mocked(invoke).mockImplementationOnce(
      () => new Promise<unknown>((resolve) => (finishQuery = resolve)),
    );
    const adapter = new TauriJavaNavigationAdapter();
    const pending = adapter.query(request);

    await adapter.cancel(request.requestId);
    expect(invoke).toHaveBeenNthCalledWith(2, "cancel_refactorkit_java_navigation_query", {
      context: { workspaceId: request.workspaceId, generation: request.generation },
      requestId: request.requestId,
    });

    finishQuery(ready());
    await expect(pending).resolves.toMatchObject({ status: "ready" });
    await adapter.cancel(request.requestId);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("passes the exact editor authority to native code and validates compiler source views", async () => {
    vi.mocked(invoke).mockResolvedValue(ready());
    await expect(new TauriJavaNavigationAdapter().query(request)).resolves.toEqual(ready());
    expect(invoke).toHaveBeenCalledWith("query_refactorkit_java_navigation", { request });
  });

  it.each([
    { workspaceId: "other" },
    { generation: 3 },
    { requestId: "other" },
    { documentVersion: 8 },
    { documentPath: "Other.java" },
    { kind: "references" },
    { provider: { ...ready().provider, evidence: "structural" } },
    { snapshotHash: "unverified" },
    { indexGeneration: 0 },
  ])("rejects another request or unsupported evidence: %j", (change) => {
    expect(() => normalizeJavaNavigation({ ...ready(), ...change }, request)).toThrow();
  });

  it("preserves incomplete analysis and a truncated return limit independently", () => {
    const references = { ...request, kind: "references" as const };
    const value = { ...ready(references), total: 2, truncated: true };
    expect(normalizeJavaNavigation(value, references)).toMatchObject({
      complete: true,
      truncated: true,
    });
    expect(
      normalizeJavaNavigation({ ...value, complete: false, warningCount: 2 }, references),
    ).toMatchObject({ complete: false, warningCount: 2 });
    expect(() => normalizeJavaNavigation({ ...value, truncated: false }, references)).toThrow();
  });

  it("normalizes bounded type and call hierarchy items under the requested direction", () => {
    const hierarchyRequest: JavaNavigationRequest = {
      ...request,
      kind: "typeHierarchy",
      direction: "subtypes",
      limit: 20,
    };
    const hierarchyLocation = ready().locations[0];
    const hierarchy = normalizeJavaNavigation(
      {
        ...ready(hierarchyRequest),
        rootName: "example.Main",
        scope: "workspace-source",
        direction: "subtypes",
        items: [{ label: "example.Helper", relation: "subtype", location: hierarchyLocation }],
      },
      hierarchyRequest,
    );
    expect(hierarchy).toMatchObject({
      status: "ready",
      kind: "typeHierarchy",
      rootName: "example.Main",
      direction: "subtypes",
      returned: 1,
      items: [{ relation: "subtype", label: "example.Helper" }],
    });
    expect(() =>
      normalizeJavaNavigation(
        {
          ...ready(hierarchyRequest),
          rootName: "example.Main",
          scope: "workspace-source",
          direction: "supertypes",
          items: [],
        },
        hierarchyRequest,
      ),
    ).toThrow("Invalid or uncorrelated");

    const callsRequest: JavaNavigationRequest = {
      ...request,
      kind: "callHierarchy",
      direction: "incoming",
      limit: 10,
    };
    const method = ready().locations[0];
    const callSite = {
      path: "Helper.java",
      range: { start: { line: 0, character: 5 }, end: { line: 0, character: 8 } },
    };
    const calls = normalizeJavaNavigation(
      {
        ...ready(callsRequest),
        complete: false,
        warningCount: 1,
        rootName: "example.Helper#sum(int)",
        scope: "workspace-direct-invocations",
        direction: "incoming",
        locations: [method, callSite],
        items: [{ label: "example.Main#run()", location: method, callSites: [callSite] }],
      },
      callsRequest,
    );
    expect(calls).toMatchObject({
      status: "ready",
      complete: false,
      returned: 1,
      items: [{ label: "example.Main#run()", callSites: [callSite] }],
    });
    const uncorrelatedSite: Record<string, unknown> = {
      ...ready(callsRequest),
      rootName: "example.Helper#sum(int)",
      scope: "workspace-direct-invocations",
      direction: "incoming",
      items: [{ label: "example.Main#run()", location: method, callSites: [callSite] }],
    };
    expect(() => normalizeJavaNavigation(uncorrelatedSite, callsRequest)).toThrow(
      "Invalid or uncorrelated",
    );
  });

  it("keeps exact binary call targets visible without inventing source locations", () => {
    const callsRequest: JavaNavigationRequest = {
      ...request,
      kind: "callHierarchy",
      direction: "outgoing",
      limit: 10,
    };
    const callSite = {
      path: "Helper.java",
      range: { start: { line: 0, character: 5 }, end: { line: 0, character: 8 } },
    };
    const methodIdentity = {
      schemaVersion: "java-method-binding-identity-v1",
      name: "pick",
      qualifiedName: "dependency.Overloads#pick(int)",
      bindingKey: "<sanitized-binding-key>",
      jvmIdentity: {
        kind: "callable",
        ownerBinaryName: "dependency.Overloads",
        memberName: "pick",
        descriptor: "(I)Ljava/lang/String;",
      },
    } as const;
    const response = {
      ...ready(callsRequest),
      complete: false,
      warningCount: 2,
      total: 1,
      returned: 1,
      rootName: "app.Caller#invoke(java.lang.String)",
      scope: "workspace-direct-invocations",
      targetScope: "workspace-source+resolved-classpath",
      direction: "outgoing",
      locations: [callSite],
      items: [
        {
          label: methodIdentity.qualifiedName,
          methodIdentity,
          sourceNavigation: {
            status: "unavailable",
            reason: "classpathSourceUnavailable",
            location: null,
          },
          callSites: [callSite],
        },
      ],
    };
    const result = normalizeJavaNavigation(response, callsRequest);
    expect(result).toMatchObject({
      kind: "callHierarchy",
      targetScope: "workspace-source+resolved-classpath",
      items: [
        {
          label: methodIdentity.qualifiedName,
          methodIdentity,
          sourceNavigation: {
            status: "unavailable",
            reason: "classpathSourceUnavailable",
            location: null,
          },
          callSites: [callSite],
        },
      ],
    });
    expect(result.status === "ready" && result.items[0].location).toBeUndefined();

    for (const invalid of [
      { ...response, targetScope: "workspace-only" },
      {
        ...response,
        items: [{ ...response.items[0], methodIdentity: undefined }],
      },
      {
        ...response,
        items: [
          {
            ...response.items[0],
            sourceNavigation: { status: "unavailable", reason: "unknown", location: null },
          },
        ],
      },
      {
        ...response,
        items: [{ ...response.items[0], location: callSite }],
      },
    ])
      expect(() => normalizeJavaNavigation(invalid, callsRequest)).toThrow(
        "Invalid or uncorrelated",
      );
  });

  it("normalizes implementation results only for the attested source scope and target kind", () => {
    const implementationsRequest: JavaNavigationRequest = {
      ...request,
      kind: "implementations",
      limit: 20,
    };
    const location = ready().locations[0];
    const response = {
      ...ready(implementationsRequest),
      rootName: "example.Handler",
      targetKind: "type",
      scope: "workspace-source",
      items: [{ label: "example.FileHandler", relation: "concreteType", location }],
    };
    expect(normalizeJavaNavigation(response, implementationsRequest)).toMatchObject({
      kind: "implementations",
      rootName: "example.Handler",
      targetKind: "type",
      scope: "workspace-source",
      items: [{ relation: "concreteType", label: "example.FileHandler" }],
    });
    for (const invalid of [
      { ...response, scope: "workspace-direct-invocations" },
      { ...response, targetKind: "method" },
      { ...response, targetKind: "unknown" },
      { ...response, direction: "all" },
      { ...response, returned: 0 },
    ])
      expect(() => normalizeJavaNavigation(invalid, implementationsRequest)).toThrow();
    expect(() =>
      normalizeJavaNavigation(
        {
          ...response,
          items: [{ label: "example.FileHandler", relation: "concreteMethod", location }],
        },
        implementationsRequest,
      ),
    ).toThrow();
  });

  it("normalizes a type hierarchy from a configured nested Maven project", async () => {
    const nestedRequest: JavaNavigationRequest = {
      ...request,
      document: {
        ...request.document,
        path: "project/src/main/java/example/Runner.java",
      },
      kind: "typeHierarchy",
      direction: "supertypes",
      limit: 200,
      projectContext: {
        projectPath: "project",
        sdkHome: "/jdk",
        mavenRepository: "/maven",
        activeMavenProfiles: [],
        inactiveMavenProfiles: [],
        snapshotHash: "a".repeat(64),
        contextHash: "c".repeat(64),
        platformIdentities: ["d".repeat(64)],
      },
    };
    const location = {
      path: "project/src/main/java/example/BaseGreeting.java",
      range: { start: { line: 0, character: 6 }, end: { line: 0, character: 18 } },
    };
    const response = {
      ...ready(nestedRequest),
      projectContext: {
        projectPath: "project",
        contextHash: "c".repeat(64),
        contextSchemaVersion: "java-project-context-v1",
        platformIdentities: ["d".repeat(64)],
      },
      sourceFiles: [{ path: location.path, text: "class BaseGreeting {}" }],
      locations: [location],
      items: [{ label: "example.BaseGreeting", relation: "supertype", location }],
      returned: 1,
      total: 1,
      rootName: "example.GreetingService",
      scope: "workspace-source",
      direction: "supertypes",
    };
    vi.mocked(invoke).mockResolvedValueOnce(response);

    await expect(new TauriJavaNavigationAdapter().query(nestedRequest)).resolves.toMatchObject({
      status: "ready",
      projectContext: {
        projectPath: "project",
        contextHash: "c".repeat(64),
        contextSchemaVersion: "java-project-context-v1",
        platformIdentities: ["d".repeat(64)],
      },
      sourceFiles: [{ path: location.path }],
      rootName: "example.GreetingService",
      direction: "supertypes",
      items: [{ label: "example.BaseGreeting", relation: "supertype", location }],
    });
    expect(invoke).toHaveBeenCalledWith("query_refactorkit_java_navigation", {
      request: nestedRequest,
    });
  });

  it("records bounded response shape without source text in opt-in native diagnostics", async () => {
    const nestedRequest: JavaNavigationRequest = {
      ...request,
      document: { ...request.document, path: "project/src/main/java/example/Runner.java" },
      kind: "typeHierarchy",
      direction: "supertypes",
      limit: 20,
      projectContext: {
        projectPath: "project",
        sdkHome: "/jdk",
        mavenRepository: "/maven",
        activeMavenProfiles: [],
        inactiveMavenProfiles: [],
        snapshotHash: "a".repeat(64),
        contextHash: "c".repeat(64),
        platformIdentities: ["d".repeat(64)],
      },
    };
    const previousEnabled = document.body.getAttribute("data-native-java-navigation-diagnostics");
    const previousShape = document.body.getAttribute(
      "data-java-navigation-provider-response-shape",
    );
    const location = {
      path: "project/src/main/java/example/BaseGreeting.java",
      range: { start: { line: 0, character: 6 }, end: { line: 0, character: 18 } },
    };
    vi.mocked(invoke).mockResolvedValueOnce({
      ...ready(nestedRequest),
      projectContext: {
        projectPath: "project",
        contextHash: "c".repeat(64),
        contextSchemaVersion: "java-project-context-v1",
        platformIdentities: ["d".repeat(64)],
      },
      locations: [location],
      sourceFiles: [
        { path: "project/src/main/java/example/Other.java", text: "private source code" },
      ],
      items: [{ label: "example.BaseGreeting", relation: "supertype", location }],
      returned: 1,
      total: 1,
      rootName: "example.GreetingService",
      scope: "workspace-source",
      direction: "supertypes",
    });

    document.body.setAttribute("data-native-java-navigation-diagnostics", "");
    try {
      await expect(new TauriJavaNavigationAdapter().query(nestedRequest)).rejects.toThrow(
        "Invalid or uncorrelated",
      );
      const shape = JSON.parse(
        document.body.getAttribute("data-java-navigation-provider-response-shape") ?? "{}",
      );
      expect(shape).toMatchObject({
        kind: "typeHierarchy",
        status: "ready",
        projectContext: { projectPath: "project", contextHashMatches: true },
        rootName: "example.GreetingService",
        locations: { count: 1, firstPaths: [location.path] },
        sourceFiles: {
          count: 1,
          firstPaths: ["project/src/main/java/example/Other.java"],
        },
        items: [{ label: "example.BaseGreeting", locationPath: location.path }],
      });
      expect(JSON.stringify(shape)).not.toContain("private source code");
    } finally {
      if (previousEnabled === null)
        document.body.removeAttribute("data-native-java-navigation-diagnostics");
      else document.body.setAttribute("data-native-java-navigation-diagnostics", previousEnabled);
      if (previousShape === null)
        document.body.removeAttribute("data-java-navigation-provider-response-shape");
      else
        document.body.setAttribute("data-java-navigation-provider-response-shape", previousShape);
    }
  });

  it("normalizes a compiler-bound Java type definition as one workspace location", () => {
    const typeRequest: JavaNavigationRequest = { ...request, kind: "typeDefinition", limit: 1 };
    const type = normalizeJavaNavigation(
      {
        ...ready(typeRequest),
        rootName: "example.Helper",
        scope: "workspace-source",
      },
      typeRequest,
    );
    expect(type).toMatchObject({
      status: "ready",
      kind: "typeDefinition",
      rootName: "example.Helper",
      scope: "workspace-source",
      returned: 1,
      locations: [{ path: "Helper.java" }],
    });
  });

  it("refuses escaped paths, missing source views and positions splitting UTF-16 surrogates", () => {
    const value = ready();
    for (const character of [2, 9999]) {
      expect(() =>
        normalizeJavaNavigation(
          {
            ...value,
            locations: [
              {
                path: "Helper.java",
                range: {
                  start: { line: 0, character },
                  end: { line: 0, character },
                },
              },
            ],
          },
          request,
        ),
      ).toThrow();
    }
    expect(() => normalizeJavaNavigation({ ...value, sourceFiles: [] }, request)).toThrow();
    for (const path of ["../Helper.java", "/Helper.java", "C:/Helper.java", "src\\Helper.java"]) {
      expect(() =>
        normalizeJavaNavigation(
          {
            ...value,
            sourceFiles: [{ path, text: "class Helper {}" }],
            locations: [{ ...value.locations[0], path }],
          },
          request,
        ),
      ).toThrow();
    }
    expect(() =>
      normalizeJavaNavigation(
        { ...value, sourceFiles: [value.sourceFiles[0], value.sourceFiles[0]] },
        request,
      ),
    ).toThrow();
  });

  it("bounds preview bytes before creating Monaco models", () => {
    expect(() =>
      normalizeJavaNavigation(
        { ...ready(), sourceFiles: [{ path: "Helper.java", text: "x".repeat(1024 * 1024 + 1) }] },
        request,
      ),
    ).toThrow();
  });

  it("refuses invalid source authority before native invocation", async () => {
    const adapter = new TauriJavaNavigationAdapter();
    for (const query of [
      { ...request, limit: 1000 },
      { ...request, kind: "typeHierarchy" as const, direction: "both" as const, limit: 201 },
      { ...request, kind: "callHierarchy" as const, direction: "incoming" as const, limit: 501 },
      { ...request, kind: "implementations" as const, limit: 201 },
      { ...request, document: { ...request.document, path: "../Main.java" } },
      { ...request, position: { line: 0, character: request.document.text.indexOf("😀") + 1 } },
    ])
      await expect(adapter.query(query)).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("exposes provider refusal and scopes session cleanup to its workspace generation", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({ ...ready(), status: "unavailable", message: "Install RefactorKit." })
      .mockResolvedValueOnce(undefined);
    const adapter = new TauriJavaNavigationAdapter();
    await expect(adapter.query(request)).resolves.toMatchObject({
      status: "unavailable",
      message: "Install RefactorKit.",
    });
    await adapter.stop({ workspaceId: "workspace", generation: 4 });
    expect(invoke).toHaveBeenLastCalledWith("stop_refactorkit_java_navigation", {
      context: { workspaceId: "workspace", generation: 4 },
    });
    const browserResult = await new BrowserJavaNavigationAdapter().query(request);
    expect(browserResult.status).toBe("unavailable");
    expect(browserResult).not.toHaveProperty("locations");
  });
});
