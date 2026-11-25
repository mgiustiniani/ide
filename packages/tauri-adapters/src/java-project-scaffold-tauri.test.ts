import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { CreateJavaProjectRequest } from "@ide/contracts";
import { TauriJavaProjectScaffoldAdapter } from "./java-project-scaffold-tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const request: CreateJavaProjectRequest = {
  workspaceId: "workspace-one",
  generation: 4,
  requestId: "new-project-1",
  buildSystem: "maven",
  layout: "single-module",
  artifactId: "hello-java",
  groupId: "com.example",
  packageName: "com.example.app",
  javaRelease: 17,
};

describe("Java project scaffold adapter", () => {
  beforeEach(() => vi.mocked(invoke).mockReset());

  it("sends an explicit Java scaffold request and checks the native correlation", async () => {
    vi.mocked(invoke).mockResolvedValue({
      workspaceId: request.workspaceId,
      generation: request.generation,
      requestId: request.requestId,
      projectPath: "hello-java",
    });
    const adapter = new TauriJavaProjectScaffoldAdapter();

    await expect(adapter.createProject(request)).resolves.toEqual({
      workspaceId: request.workspaceId,
      generation: request.generation,
      requestId: request.requestId,
      projectPath: "hello-java",
    });
    expect(invoke).toHaveBeenCalledWith("create_java_project", { request });
  });

  it("preserves the selected Gradle build system", async () => {
    const gradleRequest = {
      ...request,
      buildSystem: "gradle" as const,
      gradleDsl: "kotlin" as const,
      layout: "multi-module" as const,
    };
    vi.mocked(invoke).mockResolvedValue({
      workspaceId: gradleRequest.workspaceId,
      generation: gradleRequest.generation,
      requestId: gradleRequest.requestId,
      projectPath: gradleRequest.artifactId,
    });

    await expect(new TauriJavaProjectScaffoldAdapter().createProject(gradleRequest)).resolves.toMatchObject({
      projectPath: "hello-java",
      requestId: gradleRequest.requestId,
    });
    expect(invoke).toHaveBeenCalledWith("create_java_project", { request: gradleRequest });
  });

  it("rejects results from another workspace generation", async () => {
    vi.mocked(invoke).mockResolvedValue({
      workspaceId: request.workspaceId,
      generation: request.generation + 1,
      requestId: request.requestId,
      projectPath: "hello-java",
    });
    await expect(new TauriJavaProjectScaffoldAdapter().createProject(request)).rejects.toThrow(
      "Uncorrelated Java project creation result.",
    );
  });
});
