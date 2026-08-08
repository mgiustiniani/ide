import type { Xcom2ProjectBuildRecipeCandidate } from "@ide/contracts";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TauriAdapterError } from "./errors";
import {
  TauriXcom2NativeActivationEvidenceAdapter,
  TauriXcom2ProjectBuildRecipeInspectionAdapter,
  XCOM2_NATIVE_ACTIVATION_EVIDENCE_COMMANDS,
  XCOM2_PROJECT_BUILD_RECIPE_INSPECTION_COMMAND,
  createTauriAdapters,
  createTauriXcom2NativeActivationEvidencePort,
  createTauriXcom2ProjectBuildRecipeInspectionPort,
} from "./index";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);
const command = "inspect_xcom2_project_build_recipe";
const request = {
  workspaceId: "workspace:fixture-001",
  generation: 7,
  moduleRoot: "projects/MyMod",
} as const;

function candidate(): Xcom2ProjectBuildRecipeCandidate {
  return {
    schemaVersion: 1,
    canonicalization: "RFC 8785",
    digestAlgorithm: "SHA-256",
    workspace: { id: request.workspaceId, generation: request.generation },
    module: {
      id: "xcom2-module:MyMod",
      root: request.moduleRoot,
      activationGeneration: 4,
      entryType: "directory",
      containsSymlink: false,
    },
    inspectionGeneration: 3,
    script: {
      relativePath: ".scripts/build.ps1",
      entryType: "regular-file",
      containsSymlink: false,
      trust: "untrusted-project-input",
      sha256: "3f6a97803f5e69f4c35d5a01151af28603594dd6bd314e8991bfdfe6a2cc6389",
      byteSize: 103,
    },
    provenance: {
      project: "X2ModBuildCommon",
      license: "MIT",
      notice: {
        identity: "x2modbuildcommon-mit-notice-v1",
        text: "Derived from X2ModBuildCommon concepts. Copyright its contributors; licensed under MIT.",
        sha256: "c65dfc8d09689df4b3f2ba099aca7ebcd481de9ea7887dcfa09b508d8af1abfe",
      },
    },
    action: "default",
    arguments: [
      { role: "source-directory", valueState: "current-module", value: request.moduleRoot },
      {
        role: "sdk-directory",
        valueState: "unresolved",
        value: "separate-machine-authorization-required",
      },
      {
        role: "game-directory",
        valueState: "unresolved",
        value: "separate-machine-authorization-required",
      },
      { role: "configuration", valueState: "declared", value: "Default" },
      { role: "build-prefix", valueState: "unresolved", value: "pfx_copy" },
      {
        role: "highlander-source",
        valueState: "project-local",
        value: "Highlander/XComGame",
      },
      {
        role: "highlander-runtime",
        valueState: "unresolved",
        value: "workshop:1134256495",
      },
    ],
    dependencies: {
      buildPrefix: { identity: "pfx_copy", state: "unresolved" },
      highlanderSource: {
        identity: "highlander-source:local",
        relativePath: "Highlander/XComGame",
        state: "project-local",
        entryType: "directory",
        containsSymlink: false,
      },
      highlanderRuntime: { identity: "workshop:1134256495", state: "unresolved" },
    },
    unresolvedPrerequisites: [
      { role: "sdk-directory", identity: "sdk-directory", state: "unresolved" },
      { role: "game-directory", identity: "game-directory", state: "unresolved" },
      { role: "build-prefix", identity: "pfx_copy", state: "unresolved" },
      { role: "build-tool", identity: "x2modbuildcommon-tool", state: "unresolved" },
      { role: "highlander-runtime", identity: "workshop:1134256495", state: "unresolved" },
    ],
    executionBlocked: true,
  };
}

function mutableCandidate(): any {
  return structuredClone(candidate());
}

async function expectResponseRejection(response: unknown): Promise<TauriAdapterError> {
  invokeMock.mockResolvedValueOnce(response);
  try {
    await new TauriXcom2ProjectBuildRecipeInspectionAdapter().inspect(request);
    throw new Error("expected build recipe response rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(TauriAdapterError);
    expect(error).toMatchObject({ name: "TauriAdapterError", command, cause: undefined });
    expect((error as Error).message).toContain("Invalid native XCOM 2 response:");
    return error as TauriAdapterError;
  }
}

function collectKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectKeys);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [
    key,
    ...collectKeys(child),
  ]);
}

describe("REQ-XCOM2 Tauri build recipe inspection invocation and response", () => {
  beforeEach(() => invokeMock.mockReset());

  it("exports the exact fourth command and invokes only one frozen exact request envelope", async () => {
    expect(XCOM2_PROJECT_BUILD_RECIPE_INSPECTION_COMMAND).toBe(command);
    invokeMock.mockImplementationOnce((_calledCommand, args) => {
      const envelope = args as { request: typeof request };
      expect(Reflect.ownKeys(envelope)).toEqual(["request"]);
      expect(Reflect.ownKeys(envelope.request)).toEqual([
        "workspaceId",
        "generation",
        "moduleRoot",
      ]);
      expect(Object.isFrozen(envelope)).toBe(true);
      expect(Object.isFrozen(envelope.request)).toBe(true);
      expect(envelope.request).not.toBe(request);
      expect(Reflect.set(envelope.request, "moduleRoot", "projects/Other")).toBe(false);
      return Promise.resolve(candidate());
    });

    await new TauriXcom2ProjectBuildRecipeInspectionAdapter().inspect(request);

    expect(invokeMock).toHaveBeenCalledExactlyOnceWith(command, { request });
    expect([
      ...Object.values(XCOM2_NATIVE_ACTIVATION_EVIDENCE_COMMANDS),
      XCOM2_PROJECT_BUILD_RECIPE_INSPECTION_COMMAND,
    ]).toEqual([
      "begin_xcom2_native_activation_evidence",
      "acknowledge_xcom2_native_activation_evidence",
      "revoke_xcom2_native_activation_evidence",
      "inspect_xcom2_project_build_recipe",
    ]);
  });

  it("returns only the exact detached deeply frozen candidate projection", async () => {
    const source = candidate();
    invokeMock.mockResolvedValueOnce(source);

    const result = await new TauriXcom2ProjectBuildRecipeInspectionAdapter().inspect(request);

    expect(result).toEqual(source);
    expect(Reflect.ownKeys(result)).toEqual([
      "schemaVersion",
      "canonicalization",
      "digestAlgorithm",
      "workspace",
      "module",
      "inspectionGeneration",
      "script",
      "provenance",
      "action",
      "arguments",
      "dependencies",
      "unresolvedPrerequisites",
      "executionBlocked",
    ]);
    expect(result).not.toBe(source);
    expect(result.workspace).not.toBe(source.workspace);
    expect(result.arguments).not.toBe(source.arguments);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.workspace)).toBe(true);
    expect(Object.isFrozen(result.arguments)).toBe(true);
    expect(Object.isFrozen(result.arguments[0])).toBe(true);
    expect(collectKeys(result)).not.toEqual(
      expect.arrayContaining([
        "recipeDigest",
        "capabilities",
        "command",
        "executable",
        "scriptBytes",
        "rawCommand",
        "sdkPath",
        "gamePath",
        "prefixPath",
        "proprietaryBytes",
        "availability",
      ]),
    );
  });

  it.each([
    ["workspace ID", (value: any) => (value.workspace.id = "workspace:stale")],
    ["workspace generation", (value: any) => (value.workspace.generation = 8)],
    [
      "module root",
      (value: any) => {
        value.module.root = "projects/Other";
        value.arguments[0].value = "projects/Other";
      },
    ],
  ])("rejects stale %s correlation", async (_label, mutate) => {
    const response = mutableCandidate();
    mutate(response);

    const error = await expectResponseRejection(response);

    expect(error.message).toContain("correlation is stale");
  });
});

describe("REQ-XCOM2 Tauri build recipe rejection boundary", () => {
  beforeEach(() => invokeMock.mockReset());

  it.each([
    ["absolute module root", (value: any) => (value.module.root = "/outside/MyMod")],
    ["Windows absolute module root", (value: any) => (value.module.root = "C:/outside/MyMod")],
    ["escaping module root", (value: any) => (value.module.root = "projects/../outside")],
    [
      "absolute Highlander source",
      (value: any) => (value.dependencies.highlanderSource.relativePath = "/outside/source"),
    ],
    [
      "escaping Highlander source",
      (value: any) => (value.dependencies.highlanderSource.relativePath = "Highlander/../outside"),
    ],
  ])("rejects %s", async (_label, mutate) => {
    const response = mutableCandidate();
    mutate(response);
    await expectResponseRejection(response);
  });

  it.each([
    ["raw command", "command", "pwsh .scripts/build.ps1"],
    ["raw command alias", "rawCommand", "pwsh .scripts/build.ps1"],
    ["executable", "executable", "/usr/bin/pwsh"],
    ["script bytes", "scriptBytes", "SECRET-SCRIPT-BYTES"],
    ["SDK path", "sdkPath", "/opt/proprietary-sdk"],
    ["game path", "gamePath", "/opt/proprietary-game"],
    ["prefix path", "prefixPath", "/home/user/.steam/pfx"],
    ["proprietary bytes", "proprietaryBytes", "SECRET-PROPRIETARY-BYTES"],
    ["availability flag", "availability", true],
    ["availability object", "availability", { sdk: true, game: true, prefix: true }],
    ["availability string", "availability", "/private/machine"],
  ])("rejects provider-supplied %s metadata", async (_label, field, unsafe) => {
    await expectResponseRejection({ ...candidate(), [field]: unsafe });
  });

  it.each([
    [
      "missing top-level field",
      () => {
        const value = mutableCandidate();
        delete value.action;
        return value;
      },
    ],
    [
      "extra nested field",
      () => {
        const value = mutableCandidate();
        value.script.path = "/private/script";
        return value;
      },
    ],
    [
      "malformed availability in arguments",
      () => {
        const value = mutableCandidate();
        value.arguments[1].availability = "available";
        return value;
      },
    ],
    [
      "unsafe availability in prerequisites",
      () => {
        const value = mutableCandidate();
        value.unresolvedPrerequisites[0].availablePath = "/opt/sdk";
        return value;
      },
    ],
    ["non-data class response", () => Object.assign(new (class NativeRecipe {})(), candidate())],
  ])("rejects exact-object violation: %s", async (_label, response) => {
    await expectResponseRejection(response());
  });

  it("rejects hostile response proxies and accessors without executing getters", async () => {
    const getter = vi.fn(() => candidate().workspace);
    const accessor = { ...candidate() } as Record<string, unknown>;
    Object.defineProperty(accessor, "workspace", { enumerable: true, get: getter });
    const proxy = new Proxy(candidate(), {
      getOwnPropertyDescriptor() {
        throw new Error("HOSTILE-PROXY:/private/provider-secret");
      },
    });

    await expectResponseRejection(accessor);
    await expectResponseRejection(proxy);
    expect(getter).not.toHaveBeenCalled();
  });

  it("rejects hostile request proxies and accessors before invoke without executing getters", async () => {
    const getter = vi.fn(() => request.workspaceId);
    const accessor = { ...request } as Record<string, unknown>;
    Object.defineProperty(accessor, "workspaceId", { enumerable: true, get: getter });
    const proxy = new Proxy(request, {
      ownKeys() {
        throw new Error("HOSTILE-REQUEST:/private/caller-secret");
      },
    });
    const adapter = new TauriXcom2ProjectBuildRecipeInspectionAdapter();

    await expect(adapter.inspect(accessor as typeof request)).rejects.toMatchObject({
      name: "TauriAdapterError",
      command,
    });
    await expect(adapter.inspect(proxy)).rejects.toMatchObject({
      name: "TauriAdapterError",
      command,
    });
    expect(getter).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it.each([
    ["absolute request root", { ...request, moduleRoot: "/projects/MyMod" }],
    ["escaping request root", { ...request, moduleRoot: "projects/../MyMod" }],
    ["extra request field", { ...request, sdkPath: "/opt/sdk" }],
    ["missing request field", { workspaceId: request.workspaceId, generation: request.generation }],
  ])("rejects %s before native invoke", async (_label, malformed) => {
    await expect(
      new TauriXcom2ProjectBuildRecipeInspectionAdapter().inspect(malformed as typeof request),
    ).rejects.toMatchObject({ name: "TauriAdapterError", command });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("redacts every provider rejection value and retains no cause", async () => {
    const secret = "NATIVE-RECIPE-SECRET:/private/workspace";
    invokeMock.mockRejectedValueOnce({
      message: secret,
      error: new Error(secret),
      availability: { sdkPath: secret },
    });

    let rejected: unknown;
    try {
      await new TauriXcom2ProjectBuildRecipeInspectionAdapter().inspect(request);
    } catch (error) {
      rejected = error;
    }

    expect(rejected).toMatchObject({
      name: "TauriAdapterError",
      command,
      message: `[tauri:${command}] Native XCOM 2 command failed`,
      cause: undefined,
    });
    expect(JSON.stringify(rejected)).not.toContain(secret);
  });
});

describe("REQ-XCOM2 Tauri factory exports", () => {
  it("exports fresh dedicated factories and complete factory instances", () => {
    const activation = createTauriXcom2NativeActivationEvidencePort();
    const inspection = createTauriXcom2ProjectBuildRecipeInspectionPort();
    const adapters = createTauriAdapters();

    expect(activation).toBeInstanceOf(TauriXcom2NativeActivationEvidenceAdapter);
    expect(inspection).toBeInstanceOf(TauriXcom2ProjectBuildRecipeInspectionAdapter);
    expect(adapters.xcom2NativeActivationEvidenceAdapter).toBeInstanceOf(
      TauriXcom2NativeActivationEvidenceAdapter,
    );
    expect(adapters.xcom2ProjectBuildRecipeInspectionAdapter).toBeInstanceOf(
      TauriXcom2ProjectBuildRecipeInspectionAdapter,
    );
    expect(adapters.xcom2NativeActivationEvidenceAdapter).not.toBe(activation);
    expect(adapters.xcom2ProjectBuildRecipeInspectionAdapter).not.toBe(inspection);
  });
});
