import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { TauriJavaProjectDeclarationAdapter } from "./java-project-declaration-tauri";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const request = {
  workspaceId: "one",
  generation: 3,
  requestId: "declaration-1",
  projectPath: "app",
  sdkHome: "/selected/jdk",
  release: 17,
  sourceRoots: ["src"],
  compileClasspath: [],
  runtimeClasspath: ["out"],
  outputDirectory: "out",
};
const response = {
  workspaceId: "one",
  generation: 3,
  requestId: "declaration-1",
  path: "app/.refactorkit/java-project.json",
};
describe("Java project declaration transport", () => {
  beforeEach(() => vi.mocked(invoke).mockReset());
  it("uses the native create-only command and preserves the explicit configuration", async () => {
    vi.mocked(invoke).mockResolvedValue(response);
    await expect(new TauriJavaProjectDeclarationAdapter().create(request)).resolves.toEqual(
      response,
    );
    expect(invoke).toHaveBeenCalledWith("create_java_project_declaration", { request });
  });
  it.each([
    { workspaceId: "other" },
    { generation: 4 },
    { requestId: "other" },
    { path: "other/.refactorkit/java-project.json" },
  ])("refuses a mismatched response %j", async (mismatch) => {
    vi.mocked(invoke).mockResolvedValue({ ...response, ...mismatch });
    await expect(new TauriJavaProjectDeclarationAdapter().create(request)).rejects.toThrow(
      "different workspace or target",
    );
  });
});
