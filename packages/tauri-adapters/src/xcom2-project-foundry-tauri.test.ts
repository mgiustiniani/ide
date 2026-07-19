import {
  XCOM2_PROJECT_FOUNDRY_APPLY_SCHEMA_VERSION,
  XCOM2_PROJECT_FOUNDRY_REFUSAL_CODES,
  XCOM2_PROJECT_FOUNDRY_SOURCE_COMMIT,
  XCOM2_PROJECT_FOUNDRY_SOURCE_TREE,
  type Xcom2ProjectFoundryApplyRequest,
  type Xcom2ProjectFoundryDestinationParentSelectionGrant,
  type Xcom2ProjectFoundryOperationGrant,
  type Xcom2ProjectFoundryRenderRequest,
  type Xcom2ProjectFoundrySourceSelectionGrant,
} from "@ide/contracts";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TauriAdapterError } from "./errors";
import {
  XCOM2_PROJECT_FOUNDRY_APPLY_COMMAND,
  XCOM2_PROJECT_FOUNDRY_COMMANDS,
  XCOM2_PROJECT_FOUNDRY_RENDERER_COMMANDS,
  TauriProjectFoundryAdapter,
  TauriProjectFoundryRendererAdapter,
  TauriProjectFoundrySelectionCancelledError,
  TauriXcom2ProjectFoundryAdapter,
  TauriXcom2ProjectFoundryRendererAdapter,
  createTauriProjectFoundryComposition,
  createTauriProjectFoundryRendererComposition,
  createTauriXcom2ProjectFoundryComposition,
  createTauriXcom2ProjectFoundryRendererComposition,
} from "./xcom2-project-foundry-tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const invokeMock = vi.mocked(invoke);
const openMock = vi.mocked(open);
const commands = XCOM2_PROJECT_FOUNDRY_COMMANDS;
const rendererCommands = XCOM2_PROJECT_FOUNDRY_RENDERER_COMMANDS;
const dialogCommand = "plugin:dialog|open";
const modId = "FoundryPreviewFixture";
const approvedPlanDigest = "368ab11c085c3b6150975d542850cd4c69915550ead101e244a357eb7dca8dd6";
const applyRefusalReasons = [
  "schema-version-invalid",
  "source-grant-mismatched",
  "destination-parent-grant-mismatched",
  "operation-grant-mismatched",
  "mod-id-invalid",
  "mod-id-mismatched",
  "approved-plan-digest-invalid",
  "approved-plan-digest-mismatched",
  "apply-authority-consumed",
  "source-stale",
  "destination-parent-stale",
  "destination-present",
  "rendered-plan-invalid",
  "stage-conflict",
  "journal-conflict",
] as const;
const applyPreCommitFailureReasons = [
  "journal-create-failed",
  "journal-sync-failed",
  "stage-create-failed",
  "stage-write-failed",
  "stage-verify-failed",
  "stage-sync-failed",
  "parent-sync-failed",
  "atomic-commit-failed",
  "cleanup-failed",
] as const;
const applyPostCommitFailureReasons = [
  "post-commit-parent-sync-failed",
  "post-commit-journal-failed",
] as const;
const applyCleanupStatuses = ["verified-complete", "not-verified"] as const;
const applyFailureFixtures = applyPreCommitFailureReasons.flatMap((reason) =>
  applyCleanupStatuses.map((cleanupStatus) => [reason, cleanupStatus] as const),
);

function sourceGrant(
  overrides: Record<string, unknown> = {},
): Xcom2ProjectFoundrySourceSelectionGrant {
  return {
    kind: "source-repository",
    repository: "/source/repository",
    identity: "source-grant:1",
    ...overrides,
  } as Xcom2ProjectFoundrySourceSelectionGrant;
}

function destinationGrant(
  overrides: Record<string, unknown> = {},
): Xcom2ProjectFoundryDestinationParentSelectionGrant {
  return {
    kind: "destination-parent",
    parent: "/destination/parent",
    identity: "destination-grant:1",
    ...overrides,
  } as Xcom2ProjectFoundryDestinationParentSelectionGrant;
}

function operationGrant(
  overrides: Record<string, unknown> = {},
): Xcom2ProjectFoundryOperationGrant {
  return {
    kind: "preview-operation",
    derivedDestination: `/destination/parent/${modId}`,
    identity: "operation-grant:1",
    ...overrides,
  } as Xcom2ProjectFoundryOperationGrant;
}

function renderRequest(overrides: Record<string, unknown> = {}): Xcom2ProjectFoundryRenderRequest {
  return {
    sourceGrant: sourceGrant(),
    destinationParentGrant: destinationGrant(),
    modId,
    ...overrides,
  } as Xcom2ProjectFoundryRenderRequest;
}

function renderedResult(
  planBody: unknown = { schemaVersion: 1, entries: ["Config", "Src"] },
  grant: Xcom2ProjectFoundryOperationGrant = operationGrant(),
): Record<string, unknown> {
  return { kind: "rendered", operationGrant: grant, planBody };
}

function applyRequest(overrides: Record<string, unknown> = {}): Xcom2ProjectFoundryApplyRequest {
  return {
    schemaVersion: XCOM2_PROJECT_FOUNDRY_APPLY_SCHEMA_VERSION,
    sourceGrant: sourceGrant(),
    destinationParentGrant: destinationGrant(),
    operationGrant: operationGrant(),
    modId,
    approvedPlanDigest,
    ...overrides,
  } as Xcom2ProjectFoundryApplyRequest;
}

function createdReceipt(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    result: "created",
    planDigest: approvedPlanDigest,
    finalProjectLocation: `/destination/parent/${modId}`,
    sourceCommit: XCOM2_PROJECT_FOUNDRY_SOURCE_COMMIT,
    sourceTree: XCOM2_PROJECT_FOUNDRY_SOURCE_TREE,
    committedDirectories: 12,
    committedFiles: 27,
    ...overrides,
  };
}

function nestedJson(depth: number): unknown {
  let value: unknown = "leaf";
  for (let index = 0; index < depth; index += 1) value = [value];
  return value;
}

function nodeBoundPlan(extraNodes = 0): Record<string, unknown> {
  return {
    groups: Array.from({ length: 256 }, () => Array(38).fill(null)),
    remainder: Array(13 + extraNodes).fill(null),
  };
}

function destinationSelection(
  parent = "/destination/parent",
  selectedModId = modId,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    destinationParentGrant: destinationGrant({ parent }),
    operationGrant: operationGrant({ derivedDestination: `${parent}/${selectedModId}` }),
    ...overrides,
  };
}

function evidence(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    commit: XCOM2_PROJECT_FOUNDRY_SOURCE_COMMIT,
    tree: XCOM2_PROJECT_FOUNDRY_SOURCE_TREE,
    fingerprintResult: "Verified",
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function hiddenExtra(value: object, key: PropertyKey): object {
  Object.defineProperty(value, key, {
    configurable: true,
    enumerable: false,
    value: "/private/provider/SECRET-PATH",
  });
  return value;
}

async function captureRejection(operation: Promise<unknown>): Promise<Error> {
  try {
    await operation;
    throw new Error("expected operation to reject");
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error as Error;
  }
}

async function expectProtocolRejection(
  operation: Promise<unknown>,
  command: string,
  phase: "request" | "response",
): Promise<TauriAdapterError> {
  const error = await captureRejection(operation);
  expect(error).toBeInstanceOf(TauriAdapterError);
  expect(error).toMatchObject({ name: "TauriAdapterError", command, cause: undefined });
  expect(error.message).toMatch(
    new RegExp(`^\\[tauri:${command}\\] Invalid Project Foundry ${phase}:`, "u"),
  );
  return error as TauriAdapterError;
}

beforeEach(() => {
  invokeMock.mockReset();
  openMock.mockReset();
});

describe("Project Foundry exact commands, dialog options, arguments, and order", () => {
  it("publishes the exact frozen native command vocabulary", () => {
    expect(commands).toEqual({
      authorizeSourceRepository: "authorize_xcom2_project_foundry_source_repository",
      resolveSourceObject: "resolve_xcom2_project_foundry_source_object",
      authorizeDestinationParent: "authorize_xcom2_project_foundry_destination_parent",
      inspectDestination: "inspect_xcom2_project_foundry_destination",
      revokeAll: "revoke_all_xcom2_project_foundry_preview_grants",
    });
    expect(Object.isFrozen(commands)).toBe(true);
    expect(Reflect.set(commands, "revokeAll", "unsafe")).toBe(false);
  });

  it("opens the source directory with exact options before invoking the exact source command", async () => {
    const events: string[] = [];
    openMock.mockImplementationOnce((options) => {
      events.push("dialog");
      expect(options).toEqual({ directory: true, multiple: false });
      expect(Reflect.ownKeys(options as object)).toEqual(["directory", "multiple"]);
      expect(Object.isFrozen(options)).toBe(true);
      return Promise.resolve("/source/repository");
    });
    invokeMock.mockImplementationOnce((command, args) => {
      events.push("invoke");
      expect(command).toBe(commands.authorizeSourceRepository);
      expect(args).toEqual({ request: { selectedRoot: "/source/repository" } });
      return Promise.resolve(sourceGrant());
    });

    await new TauriXcom2ProjectFoundryAdapter().selectSourceRepository();

    expect(events).toEqual(["dialog", "invoke"]);
    expect(openMock).toHaveBeenCalledExactlyOnceWith({ directory: true, multiple: false });
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith(commands.authorizeSourceRepository, {
      request: { selectedRoot: "/source/repository" },
    });
  });

  it("forwards the exact case-preserved ModId after the destination dialog and no other args", async () => {
    const exactModId = "Case_Preserved123";
    const events: string[] = [];
    openMock.mockImplementationOnce(() => {
      events.push("dialog");
      return Promise.resolve("/destination/root");
    });
    invokeMock.mockImplementationOnce((_command, args) => {
      events.push("invoke");
      expect(Reflect.ownKeys(args as object)).toEqual(["request"]);
      expect(Reflect.ownKeys((args as { request: object }).request)).toEqual([
        "selectedRoot",
        "modId",
      ]);
      return Promise.resolve(destinationSelection("/destination/root", exactModId));
    });

    await new TauriXcom2ProjectFoundryAdapter().selectDestinationParent(exactModId);

    expect(events).toEqual(["dialog", "invoke"]);
    expect(openMock).toHaveBeenCalledExactlyOnceWith({ directory: true, multiple: false });
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith(commands.authorizeDestinationParent, {
      request: { selectedRoot: "/destination/root", modId: exactModId },
    });
  });

  it("invokes source resolution with only the exact copied grant request", async () => {
    invokeMock.mockResolvedValueOnce(evidence());

    await new TauriXcom2ProjectFoundryAdapter().resolvePinnedObject(sourceGrant());

    expect(invokeMock).toHaveBeenCalledExactlyOnceWith(commands.resolveSourceObject, {
      request: { grant: sourceGrant() },
    });
    expect(openMock).not.toHaveBeenCalled();
  });

  it("invokes destination inspection with exact grant names and args", async () => {
    invokeMock.mockResolvedValueOnce("absent");

    await new TauriXcom2ProjectFoundryAdapter().inspectDerivedDestination(
      destinationGrant(),
      operationGrant(),
    );

    expect(invokeMock).toHaveBeenCalledExactlyOnceWith(commands.inspectDestination, {
      request: {
        destinationParentGrant: destinationGrant(),
        operationGrant: operationGrant(),
      },
    });
    expect(openMock).not.toHaveBeenCalled();
  });

  it("invokes revocation with no payload", async () => {
    invokeMock.mockResolvedValueOnce(undefined);

    await new TauriXcom2ProjectFoundryAdapter().revokeAll();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls[0]).toEqual([commands.revokeAll, undefined]);
    expect(openMock).not.toHaveBeenCalled();
  });
});

describe("Project Foundry selector cancellation and ModId validation", () => {
  it.each([
    [
      "source-repository",
      (adapter: TauriXcom2ProjectFoundryAdapter) => adapter.selectSourceRepository(),
    ],
    [
      "destination-parent",
      (adapter: TauriXcom2ProjectFoundryAdapter) => adapter.selectDestinationParent(modId),
    ],
  ] as const)(
    "reports exact %s cancellation without invoking native authorization",
    async (selection, call) => {
      openMock.mockResolvedValueOnce(null);

      const error = await captureRejection(call(new TauriXcom2ProjectFoundryAdapter()));

      expect(error).toBeInstanceOf(TauriProjectFoundrySelectionCancelledError);
      expect(error.name).toBe("TauriProjectFoundrySelectionCancelledError");
      expect(error.message).toBe("Native directory selection was cancelled");
      expect((error as TauriProjectFoundrySelectionCancelledError).selection).toBe(selection);
      expect("cause" in error).toBe(false);
      expect(invokeMock).not.toHaveBeenCalled();
    },
  );

  it.each(["A", "A1_b", "Z".repeat(48)])(
    "accepts inclusive ModId grammar bound %j",
    async (value) => {
      openMock.mockResolvedValueOnce("/destination");
      invokeMock.mockResolvedValueOnce(destinationSelection("/destination", value));

      await new TauriXcom2ProjectFoundryAdapter().selectDestinationParent(value);

      expect(invokeMock).toHaveBeenCalledExactlyOnceWith(commands.authorizeDestinationParent, {
        request: { selectedRoot: "/destination", modId: value },
      });
    },
  );

  it.each([
    ["omitted", undefined],
    ["empty", ""],
    ["starts with digit", "1Alpha"],
    ["contains hyphen", "Alpha-Beta"],
    ["contains space", "Alpha Beta"],
    ["contains non-ASCII", "Alphé"],
    ["contains control", "Alpha\n"],
    ["contains lone high surrogate", "Alpha\ud800"],
    ["contains lone low surrogate", "Alpha\udc00"],
    ["above 48 characters", "A".repeat(49)],
    ["Windows device CON", "CON"],
    ["Windows device case-insensitively", "com1"],
    ["Windows device LPT9", "LPT9"],
    ["numeric", 1],
    ["null", null],
  ])("rejects invalid ModId before opening a dialog: %s", async (_label, value) => {
    await expectProtocolRejection(
      new TauriXcom2ProjectFoundryAdapter().selectDestinationParent(value as string),
      commands.authorizeDestinationParent,
      "request",
    );

    expect(openMock).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe("Project Foundry canonical paths and bounded identities", () => {
  it("accepts root and exact 4096-byte Linux paths plus exact 128-byte identities", async () => {
    const maximumPath = `/${"a".repeat(4_095)}`;
    const maximumIdentity = `A${"b".repeat(127)}`;
    openMock.mockResolvedValueOnce(maximumPath);
    invokeMock.mockResolvedValueOnce(
      sourceGrant({ repository: maximumPath, identity: maximumIdentity }),
    );

    const result = await new TauriXcom2ProjectFoundryAdapter().selectSourceRepository();

    expect(new TextEncoder().encode(maximumPath)).toHaveLength(4_096);
    expect(new TextEncoder().encode(maximumIdentity)).toHaveLength(128);
    expect(result).toEqual(sourceGrant({ repository: maximumPath, identity: maximumIdentity }));

    openMock.mockResolvedValueOnce("/");
    invokeMock.mockResolvedValueOnce({
      destinationParentGrant: destinationGrant({ parent: "/", identity: maximumIdentity }),
      operationGrant: operationGrant({
        derivedDestination: `/${modId}`,
        identity: "operation-grant:root",
      }),
    });
    await expect(
      new TauriXcom2ProjectFoundryAdapter().selectDestinationParent(modId),
    ).resolves.toMatchObject({ destinationParentGrant: { parent: "/" } });
  });

  it.each([
    ["non-string", 1],
    ["empty", ""],
    ["relative", "relative/path"],
    ["Windows drive", "C:/source"],
    ["backslash", "/source\\child"],
    ["trailing slash", "/source/"],
    ["empty component", "/source//child"],
    ["dot component", "/source/./child"],
    ["parent component", "/source/../child"],
    ["C0 control", "/source/secret\u0000"],
    ["C1 control", "/source/secret\u009f"],
    ["lone high surrogate terminal", "/source/\ud800"],
    ["lone high surrogate before text", "/source/\ud800A"],
    ["lone low surrogate", "/source/\udc00"],
    ["above 4096 ASCII bytes", `/${"a".repeat(4_096)}`],
    ["above 4096 multibyte bytes", `/${"é".repeat(2_048)}`],
  ])("rejects unsafe dialog path: %s", async (_label, path) => {
    openMock.mockResolvedValueOnce(path as string);

    await expectProtocolRejection(
      new TauriXcom2ProjectFoundryAdapter().selectSourceRepository(),
      dialogCommand,
      "response",
    );

    expect(invokeMock).not.toHaveBeenCalled();
  });

  it.each([
    ["non-string path", 1, "source-grant:1"],
    ["relative path", "source/repository", "source-grant:1"],
    ["path control", "/source/secret\n", "source-grant:1"],
    ["path lone surrogate", "/source/\ud800A", "source-grant:1"],
    ["path above byte bound", `/${"é".repeat(2_048)}`, "source-grant:1"],
    ["empty identity", "/source/repository", ""],
    ["identity invalid first character", "/source/repository", ":grant"],
    ["identity slash", "/source/repository", "grant/1"],
    ["identity space", "/source/repository", "grant 1"],
    ["identity non-string", "/source/repository", 7],
    ["identity control", "/source/repository", "grant\u007f"],
    ["identity lone surrogate", "/source/repository", "grant\ud800"],
    ["identity above 128 bytes", "/source/repository", `A${"b".repeat(128)}`],
  ])("rejects source grant path/identity constraint: %s", async (_label, repository, identity) => {
    invokeMock.mockResolvedValueOnce(sourceGrant({ repository, identity }));
    openMock.mockResolvedValueOnce("/source/repository");

    await expectProtocolRejection(
      new TauriXcom2ProjectFoundryAdapter().selectSourceRepository(),
      commands.authorizeSourceRepository,
      "response",
    );
  });

  it("rejects a terminal lone high surrogate in a caller-supplied grant before invoke", async () => {
    await expectProtocolRejection(
      new TauriXcom2ProjectFoundryAdapter().resolvePinnedObject(
        sourceGrant({ repository: "/source/\ud800" }),
      ),
      commands.resolveSourceObject,
      "request",
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      "destination relative parent",
      destinationGrant({ parent: "destination/parent" }),
      operationGrant(),
    ],
    [
      "destination parent control",
      destinationGrant({ parent: "/destination/\u0000" }),
      operationGrant(),
    ],
    [
      "destination identity too long",
      destinationGrant({ identity: `D${"x".repeat(128)}` }),
      operationGrant(),
    ],
    [
      "operation relative destination",
      destinationGrant(),
      operationGrant({ derivedDestination: "relative" }),
    ],
    [
      "operation lone surrogate",
      destinationGrant(),
      operationGrant({ derivedDestination: "/destination/\udc00" }),
    ],
    [
      "operation identity invalid",
      destinationGrant(),
      operationGrant({ identity: "operation identity" }),
    ],
  ])(
    "rejects malformed inspection grant constraint: %s",
    async (_label, destination, operation) => {
      await expectProtocolRejection(
        new TauriXcom2ProjectFoundryAdapter().inspectDerivedDestination(destination, operation),
        commands.inspectDestination,
        "request",
      );
      expect(invokeMock).not.toHaveBeenCalled();
    },
  );
});

describe("Project Foundry strict exact DTO validation", () => {
  it.each([
    ["null", null],
    ["array", []],
    ["primitive", "grant"],
    ["missing field", { kind: "source-repository", repository: "/source/repository" }],
    ["extra enumerable field", { ...sourceGrant(), providerPath: "/private/provider" }],
    ["wrong kind", sourceGrant({ kind: "destination-parent" })],
    ["wrong repository type", sourceGrant({ repository: 1 })],
    ["wrong identity type", sourceGrant({ identity: false })],
    ["class instance", Object.assign(new (class ProviderGrant {})(), sourceGrant())],
    ["date", new Date()],
  ])("rejects malformed source authorization response: %s", async (_label, response) => {
    openMock.mockResolvedValueOnce("/source/repository");
    invokeMock.mockResolvedValueOnce(response);
    await expectProtocolRejection(
      new TauriXcom2ProjectFoundryAdapter().selectSourceRepository(),
      commands.authorizeSourceRepository,
      "response",
    );
  });

  it("rejects hidden, symbol, accessor, and non-enumerable required source response fields", async () => {
    const symbolExtra = { ...sourceGrant() };
    Object.defineProperty(symbolExtra, Symbol("provider"), { value: "/private/provider" });
    const accessor = { ...sourceGrant() };
    Object.defineProperty(accessor, "repository", {
      enumerable: true,
      get: () => "/private/provider/SECRET-PATH",
    });
    const hiddenRequired = { ...sourceGrant() };
    Object.defineProperty(hiddenRequired, "identity", {
      enumerable: false,
      value: "source-grant:1",
    });
    for (const response of [
      hiddenExtra({ ...sourceGrant() }, "providerPath"),
      symbolExtra,
      accessor,
      hiddenRequired,
    ]) {
      openMock.mockResolvedValueOnce("/source/repository");
      invokeMock.mockResolvedValueOnce(response);
      await expectProtocolRejection(
        new TauriXcom2ProjectFoundryAdapter().selectSourceRepository(),
        commands.authorizeSourceRepository,
        "response",
      );
    }
  });

  it.each([
    ["null outer object", null],
    ["array outer object", []],
    ["missing operation grant", { destinationParentGrant: destinationGrant() }],
    ["extra outer field", { ...destinationSelection(), provider: "/private/provider" }],
    [
      "wrong destination kind",
      destinationSelection("/destination/parent", modId, {
        destinationParentGrant: destinationGrant({ kind: "source-repository" }),
      }),
    ],
    [
      "wrong operation kind",
      destinationSelection("/destination/parent", modId, {
        operationGrant: operationGrant({ kind: "write-operation" }),
      }),
    ],
    [
      "extra destination field",
      destinationSelection("/destination/parent", modId, {
        destinationParentGrant: { ...destinationGrant(), rawPath: "/private" },
      }),
    ],
    [
      "extra operation field",
      destinationSelection("/destination/parent", modId, {
        operationGrant: { ...operationGrant(), writable: true },
      }),
    ],
  ])("rejects malformed destination authorization response: %s", async (_label, response) => {
    openMock.mockResolvedValueOnce("/destination/parent");
    invokeMock.mockResolvedValueOnce(response);
    await expectProtocolRejection(
      new TauriXcom2ProjectFoundryAdapter().selectDestinationParent(modId),
      commands.authorizeDestinationParent,
      "response",
    );
  });

  it.each([["source selection mismatch", sourceGrant({ repository: "/other/source" })]])(
    "rejects response binding mismatch: %s",
    async (_label, response) => {
      openMock.mockResolvedValueOnce("/source/repository");
      invokeMock.mockResolvedValueOnce(response);
      await expectProtocolRejection(
        new TauriXcom2ProjectFoundryAdapter().selectSourceRepository(),
        commands.authorizeSourceRepository,
        "response",
      );
    },
  );

  it.each([
    ["parent differs from selection", destinationSelection("/other/parent")],
    ["derived child differs from ModId", destinationSelection("/destination/parent", "OtherMod")],
    [
      "identities are equal",
      {
        destinationParentGrant: destinationGrant({ identity: "same-grant" }),
        operationGrant: operationGrant({ identity: "same-grant" }),
      },
    ],
  ])("rejects destination selection binding mismatch: %s", async (_label, response) => {
    openMock.mockResolvedValueOnce("/destination/parent");
    invokeMock.mockResolvedValueOnce(response);
    await expectProtocolRejection(
      new TauriXcom2ProjectFoundryAdapter().selectDestinationParent(modId),
      commands.authorizeDestinationParent,
      "response",
    );
  });

  it.each([
    ["null", null],
    ["array", []],
    ["missing field", { kind: "source-repository", repository: "/source/repository" }],
    ["extra field", { ...sourceGrant(), rawPath: "/private/provider" }],
    ["wrong kind", sourceGrant({ kind: "other" })],
    ["wrong path type", sourceGrant({ repository: 17 })],
  ])("rejects malformed source resolution request: %s", async (_label, grant) => {
    await expectProtocolRejection(
      new TauriXcom2ProjectFoundryAdapter().resolvePinnedObject(
        grant as Xcom2ProjectFoundrySourceSelectionGrant,
      ),
      commands.resolveSourceObject,
      "request",
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      "same identities",
      destinationGrant({ identity: "same" }),
      operationGrant({ identity: "same" }),
    ],
    [
      "sibling path",
      destinationGrant(),
      operationGrant({ derivedDestination: "/destination/sibling/Mod" }),
    ],
    [
      "prefix-confusion path",
      destinationGrant(),
      operationGrant({ derivedDestination: "/destination/parent-other/Mod" }),
    ],
    [
      "nested child",
      destinationGrant(),
      operationGrant({ derivedDestination: `/destination/parent/nested/${modId}` }),
    ],
    [
      "invalid child ModId",
      destinationGrant(),
      operationGrant({ derivedDestination: "/destination/parent/1Invalid" }),
    ],
  ])(
    "rejects inconsistent inspection request bindings: %s",
    async (_label, destination, operation) => {
      await expectProtocolRejection(
        new TauriXcom2ProjectFoundryAdapter().inspectDerivedDestination(destination, operation),
        commands.inspectDestination,
        "request",
      );
      expect(invokeMock).not.toHaveBeenCalled();
    },
  );
});

describe("Project Foundry pinned evidence and destination state vocabularies", () => {
  const fingerprintResults = [
    "Verified",
    "source-commit-missing",
    "source-commit-unreadable",
    "source-commit-mismatched",
    "source-commit-fingerprint-invalid",
    "source-tree-missing",
    "source-tree-unreadable",
    "source-tree-mismatched",
    "source-tree-fingerprint-invalid",
    "source-blob-missing",
    "source-blob-unreadable",
    "source-blob-mismatched",
    "source-blob-fingerprint-invalid",
  ] as const;

  it.each(fingerprintResults)("accepts exact fingerprint result %s", async (fingerprintResult) => {
    invokeMock.mockResolvedValueOnce(evidence({ fingerprintResult }));

    const result = await new TauriXcom2ProjectFoundryAdapter().resolvePinnedObject(sourceGrant());

    expect(result).toEqual(evidence({ fingerprintResult }));
  });

  it.each([
    ["null", null],
    ["array", []],
    [
      "missing fingerprint",
      { commit: XCOM2_PROJECT_FOUNDRY_SOURCE_COMMIT, tree: XCOM2_PROJECT_FOUNDRY_SOURCE_TREE },
    ],
    ["extra key", evidence({ providerPath: "/private/provider" })],
    ["wrong commit", evidence({ commit: "0".repeat(40) })],
    ["numeric commit", evidence({ commit: 1 })],
    ["wrong tree", evidence({ tree: "f".repeat(40) })],
    ["numeric tree", evidence({ tree: 2 })],
    ["unknown fingerprint", evidence({ fingerprintResult: "verified" })],
    ["numeric fingerprint", evidence({ fingerprintResult: 1 })],
    ["fingerprint control", evidence({ fingerprintResult: "Verified\n" })],
    ["fingerprint lone surrogate", evidence({ fingerprintResult: "Verified\ud800" })],
  ])("rejects malformed pinned evidence: %s", async (_label, response) => {
    invokeMock.mockResolvedValueOnce(response);
    await expectProtocolRejection(
      new TauriXcom2ProjectFoundryAdapter().resolvePinnedObject(sourceGrant()),
      commands.resolveSourceObject,
      "response",
    );
  });

  it.each(["absent", "parent-unavailable", "present", "mismatched"] as const)(
    "accepts exact destination state %s",
    async (state) => {
      invokeMock.mockResolvedValueOnce(state);
      await expect(
        new TauriXcom2ProjectFoundryAdapter().inspectDerivedDestination(
          destinationGrant(),
          operationGrant(),
        ),
      ).resolves.toBe(state);
    },
  );

  it.each([null, undefined, "Absent", "unknown", "", 0, false, {}, []])(
    "rejects unsupported destination state %j",
    async (state) => {
      invokeMock.mockResolvedValueOnce(state);
      await expectProtocolRejection(
        new TauriXcom2ProjectFoundryAdapter().inspectDerivedDestination(
          destinationGrant(),
          operationGrant(),
        ),
        commands.inspectDestination,
        "response",
      );
    },
  );
});

describe("Project Foundry deep copying, deep freezing, and mutation isolation", () => {
  it("returns detached frozen source grant data isolated from later provider mutation", async () => {
    const provider = sourceGrant();
    openMock.mockResolvedValueOnce("/source/repository");
    invokeMock.mockResolvedValueOnce(provider);

    const result = await new TauriXcom2ProjectFoundryAdapter().selectSourceRepository();
    (provider as unknown as Record<string, unknown>).repository = "/provider/mutated";
    (provider as unknown as Record<string, unknown>).identity = "provider-mutated";

    expect(result).toEqual(sourceGrant());
    expect(result).not.toBe(provider);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Reflect.set(result, "repository", "/caller/mutated")).toBe(false);
    expect(Reflect.deleteProperty(result, "identity")).toBe(false);
  });

  it("returns a detached recursively frozen destination selection isolated from provider mutation", async () => {
    const providerDestination = destinationGrant();
    const providerOperation = operationGrant();
    const provider = {
      destinationParentGrant: providerDestination,
      operationGrant: providerOperation,
    };
    openMock.mockResolvedValueOnce("/destination/parent");
    invokeMock.mockResolvedValueOnce(provider);

    const result = await new TauriXcom2ProjectFoundryAdapter().selectDestinationParent(modId);
    (providerDestination as unknown as Record<string, unknown>).parent = "/provider/mutated";
    (providerOperation as unknown as Record<string, unknown>).derivedDestination =
      "/provider/mutated/Mod";

    expect(result).toEqual(destinationSelection());
    expect(result).not.toBe(provider);
    expect(result.destinationParentGrant).not.toBe(providerDestination);
    expect(result.operationGrant).not.toBe(providerOperation);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.destinationParentGrant)).toBe(true);
    expect(Object.isFrozen(result.operationGrant)).toBe(true);
    expect(Reflect.set(result.destinationParentGrant, "parent", "/caller/mutated")).toBe(false);
    expect(Reflect.set(result.operationGrant, "identity", "caller-mutated")).toBe(false);
  });

  it("returns detached frozen evidence isolated from later provider mutation", async () => {
    const provider = evidence();
    invokeMock.mockResolvedValueOnce(provider);

    const result = await new TauriXcom2ProjectFoundryAdapter().resolvePinnedObject(sourceGrant());
    provider.fingerprintResult = "source-commit-missing";

    expect(result).toEqual(evidence());
    expect(result).not.toBe(provider);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Reflect.set(result, "fingerprintResult", "source-tree-missing")).toBe(false);
  });

  it("detaches and deeply freezes every invoke request against provider mutation", async () => {
    const callerSource = sourceGrant();
    const callerDestination = destinationGrant();
    const callerOperation = operationGrant();
    invokeMock
      .mockImplementationOnce((_command, args) => {
        const request = (args as { request: { grant: object } }).request;
        expect(Object.isFrozen(args)).toBe(true);
        expect(Object.isFrozen(request)).toBe(true);
        expect(Object.isFrozen(request.grant)).toBe(true);
        expect(request.grant).not.toBe(callerSource);
        expect(Reflect.set(request.grant, "identity", "provider-mutated")).toBe(false);
        return Promise.resolve(evidence());
      })
      .mockImplementationOnce((_command, args) => {
        const request = (
          args as {
            request: { destinationParentGrant: object; operationGrant: object };
          }
        ).request;
        expect(Object.isFrozen(args)).toBe(true);
        expect(Object.isFrozen(request)).toBe(true);
        expect(Object.isFrozen(request.destinationParentGrant)).toBe(true);
        expect(Object.isFrozen(request.operationGrant)).toBe(true);
        expect(request.destinationParentGrant).not.toBe(callerDestination);
        expect(request.operationGrant).not.toBe(callerOperation);
        expect(Reflect.set(request.operationGrant, "identity", "provider-mutated")).toBe(false);
        return Promise.resolve("absent");
      });
    const adapter = new TauriXcom2ProjectFoundryAdapter();

    await adapter.resolvePinnedObject(callerSource);
    await adapter.inspectDerivedDestination(callerDestination, callerOperation);

    expect(callerSource).toEqual(sourceGrant());
    expect(callerDestination).toEqual(destinationGrant());
    expect(callerOperation).toEqual(operationGrant());
  });

  it("freezes selector authorization wrappers and preserves selected values", async () => {
    openMock
      .mockResolvedValueOnce("/source/repository")
      .mockResolvedValueOnce("/destination/parent");
    invokeMock
      .mockImplementationOnce((_command, args) => {
        const request = (args as { request: object }).request;
        expect(Object.isFrozen(args)).toBe(true);
        expect(Object.isFrozen(request)).toBe(true);
        expect(Reflect.set(request, "selectedRoot", "/provider/mutated")).toBe(false);
        return Promise.resolve(sourceGrant());
      })
      .mockImplementationOnce((_command, args) => {
        const request = (args as { request: object }).request;
        expect(Object.isFrozen(args)).toBe(true);
        expect(Object.isFrozen(request)).toBe(true);
        expect(Reflect.set(request, "modId", "Mutated")).toBe(false);
        return Promise.resolve(destinationSelection());
      });
    const adapter = new TauriXcom2ProjectFoundryAdapter();

    await adapter.selectSourceRepository();
    await adapter.selectDestinationParent(modId);
  });

  it("exposes frozen composition facets and equivalent factory aliases", () => {
    const composition = createTauriXcom2ProjectFoundryComposition();
    const aliasComposition = createTauriProjectFoundryComposition();

    expect(composition).toBeInstanceOf(TauriXcom2ProjectFoundryAdapter);
    expect(aliasComposition).toBeInstanceOf(TauriProjectFoundryAdapter);
    for (const facet of [
      composition.selectors,
      composition.source,
      composition.destination,
      composition.grants,
    ]) {
      expect(Object.isFrozen(facet)).toBe(true);
    }
  });
});

describe("Project Foundry revocation, concurrency, and stale-independent behavior", () => {
  it.each([null, undefined])(
    "accepts empty revocation acknowledgement %j",
    async (acknowledgement) => {
      invokeMock.mockResolvedValueOnce(acknowledgement);
      await expect(new TauriXcom2ProjectFoundryAdapter().revokeAll()).resolves.toBeUndefined();
    },
  );

  it.each([false, true, 0, "", "ok", {}, []])(
    "rejects non-empty revocation acknowledgement %j",
    async (acknowledgement) => {
      invokeMock.mockResolvedValueOnce(acknowledgement);
      await expectProtocolRejection(
        new TauriXcom2ProjectFoundryAdapter().revokeAll(),
        commands.revokeAll,
        "response",
      );
    },
  );

  it("keeps concurrent source selections bound to their own paths when responses finish out of order", async () => {
    const firstResponse = deferred<unknown>();
    const secondResponse = deferred<unknown>();
    openMock.mockResolvedValueOnce("/source/first").mockResolvedValueOnce("/source/second");
    invokeMock
      .mockImplementationOnce(() => firstResponse.promise)
      .mockImplementationOnce(() => secondResponse.promise);
    const adapter = new TauriXcom2ProjectFoundryAdapter();

    const first = adapter.selectSourceRepository();
    const second = adapter.selectSourceRepository();
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));
    secondResponse.resolve(
      sourceGrant({ repository: "/source/second", identity: "source:second" }),
    );
    await expect(second).resolves.toMatchObject({
      repository: "/source/second",
      identity: "source:second",
    });
    firstResponse.resolve(sourceGrant({ repository: "/source/first", identity: "source:first" }));
    await expect(first).resolves.toMatchObject({
      repository: "/source/first",
      identity: "source:first",
    });

    expect(invokeMock.mock.calls).toEqual([
      [commands.authorizeSourceRepository, { request: { selectedRoot: "/source/first" } }],
      [commands.authorizeSourceRepository, { request: { selectedRoot: "/source/second" } }],
    ]);
  });

  it("keeps concurrent destination selections bound to each exact ModId independently", async () => {
    const firstResponse = deferred<unknown>();
    const secondResponse = deferred<unknown>();
    openMock
      .mockResolvedValueOnce("/destination/first")
      .mockResolvedValueOnce("/destination/second");
    invokeMock
      .mockImplementationOnce(() => firstResponse.promise)
      .mockImplementationOnce(() => secondResponse.promise);
    const adapter = new TauriXcom2ProjectFoundryAdapter();

    const first = adapter.selectDestinationParent("FirstMod");
    const second = adapter.selectDestinationParent("SecondMod");
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));
    secondResponse.resolve(destinationSelection("/destination/second", "SecondMod"));
    await expect(second).resolves.toMatchObject({
      operationGrant: { derivedDestination: "/destination/second/SecondMod" },
    });
    firstResponse.resolve(destinationSelection("/destination/first", "FirstMod"));
    await expect(first).resolves.toMatchObject({
      operationGrant: { derivedDestination: "/destination/first/FirstMod" },
    });
  });

  it("does not let a stale malformed response poison an independent newer valid call", async () => {
    const staleResponse = deferred<unknown>();
    openMock.mockResolvedValueOnce("/source/stale").mockResolvedValueOnce("/source/current");
    invokeMock
      .mockImplementationOnce(() => staleResponse.promise)
      .mockResolvedValueOnce(
        sourceGrant({ repository: "/source/current", identity: "source:current" }),
      );
    const adapter = new TauriXcom2ProjectFoundryAdapter();

    const stale = adapter.selectSourceRepository();
    await expect(adapter.selectSourceRepository()).resolves.toMatchObject({
      repository: "/source/current",
    });
    staleResponse.resolve(sourceGrant({ repository: "/source/wrong", identity: "source:stale" }));
    await expectProtocolRejection(stale, commands.authorizeSourceRepository, "response");

    invokeMock.mockResolvedValueOnce(evidence());
    await expect(adapter.resolvePinnedObject(sourceGrant())).resolves.toEqual(evidence());
  });

  it("allows concurrent independent resolve, inspect, and revoke calls", async () => {
    invokeMock
      .mockResolvedValueOnce(evidence())
      .mockResolvedValueOnce("absent")
      .mockResolvedValueOnce(null);
    const adapter = new TauriXcom2ProjectFoundryAdapter();

    const [resolved, state, revoked] = await Promise.all([
      adapter.resolvePinnedObject(sourceGrant()),
      adapter.inspectDerivedDestination(destinationGrant(), operationGrant()),
      adapter.revokeAll(),
    ]);

    expect(resolved).toEqual(evidence());
    expect(state).toBe("absent");
    expect(revoked).toBeUndefined();
  });
});

describe("Project Foundry sanitized errors and hostile provider values", () => {
  it.each([
    ["raw path string", "/private/provider/SECRET-PATH"],
    ["raw Error", new Error("provider failed at /private/provider/SECRET-PATH")],
    [
      "message object",
      { message: "provider /private/provider/SECRET-PATH", raw: { token: "SECRET-TOKEN" } },
    ],
    ["error object", { error: "SECRET-TOKEN", path: "/private/provider/SECRET-PATH" }],
    [
      "reason object",
      { reason: "SECRET-TOKEN", provider: { path: "/private/provider/SECRET-PATH" } },
    ],
    [
      "opaque object",
      { status: 500, provider: { path: "/private/provider/SECRET-PATH", token: "SECRET-TOKEN" } },
    ],
  ])("sanitizes invoke rejection from %s with no raw value or cause", async (_label, failure) => {
    invokeMock.mockRejectedValueOnce(failure);

    const error = await captureRejection(
      new TauriXcom2ProjectFoundryAdapter().resolvePinnedObject(sourceGrant()),
    );

    expect(error).toBeInstanceOf(TauriAdapterError);
    expect(error).toMatchObject({
      name: "TauriAdapterError",
      command: commands.resolveSourceObject,
      message: `[tauri:${commands.resolveSourceObject}] Native Project Foundry command failed`,
      cause: undefined,
    });
    expect(error).not.toBe(failure);
    const exposed = `${error.message}\n${JSON.stringify(error)}\n${Reflect.ownKeys(error)
      .map((key) => String(Reflect.get(error, key)))
      .join("\n")}`;
    expect(exposed).not.toContain("/private/provider/SECRET-PATH");
    expect(exposed).not.toContain("SECRET-TOKEN");
    expect(exposed).not.toContain("[object Object]");
  });

  it.each([
    "foundry-linux-only",
    "source-repository-unavailable",
    "source-grant-invalid",
    "destination-parent-unavailable",
    "operation-grant-invalid",
    "mod-id-windows-device",
    "source-blob-fingerprint-invalid",
  ])("surfaces only allowlisted native rejection code %s without retaining cause", async (code) => {
    const failure = new Error(code);
    invokeMock.mockRejectedValueOnce(failure);

    const error = await captureRejection(new TauriXcom2ProjectFoundryAdapter().revokeAll());

    expect(error).toMatchObject({
      name: "TauriAdapterError",
      command: commands.revokeAll,
      message: `[tauri:${commands.revokeAll}] Native Project Foundry command rejected: ${code}`,
      cause: undefined,
    });
    expect(error).not.toBe(failure);
  });

  it("sanitizes dialog rejection without exposing raw path, provider object, or cause", async () => {
    const failure = {
      message: "dialog failed",
      provider: { path: "/private/provider/SECRET-PATH", token: "SECRET-TOKEN" },
    };
    openMock.mockRejectedValueOnce(failure);

    const error = await captureRejection(
      new TauriXcom2ProjectFoundryAdapter().selectSourceRepository(),
    );

    expect(error).toMatchObject({
      name: "TauriAdapterError",
      command: dialogCommand,
      message: `[tauri:${dialogCommand}] Native Project Foundry directory dialog failed`,
      cause: undefined,
    });
    expect(error).not.toBe(failure);
    expect(JSON.stringify(error)).not.toContain("SECRET");
    expect(error.message).not.toContain("/private/provider/SECRET-PATH");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("fails closed on a hostile Proxy without retaining or exposing its thrown inspection cause", async () => {
    const secretCause = new Error("SECRET-PROXY-CAUSE:/private/provider/SECRET-PATH");
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf: () => {
          throw secretCause;
        },
      },
    );
    invokeMock.mockResolvedValueOnce(hostile);

    const error = await expectProtocolRejection(
      new TauriXcom2ProjectFoundryAdapter().resolvePinnedObject(sourceGrant()),
      commands.resolveSourceObject,
      "response",
    );

    expect(error.message).toBe(
      `[tauri:${commands.resolveSourceObject}] Invalid Project Foundry response: source evidence could not be safely inspected`,
    );
    expect(error.cause).toBeUndefined();
    expect(error.message).not.toContain("SECRET-PROXY-CAUSE");
    expect(error.message).not.toContain("/private/provider/SECRET-PATH");
  });

  it("does not execute or expose an accessor-backed provider path", async () => {
    const getter = vi.fn(() => "/private/provider/SECRET-PATH");
    const malformed = evidence();
    Object.defineProperty(malformed, "providerPath", { enumerable: true, get: getter });
    invokeMock.mockResolvedValueOnce(malformed);

    const error = await expectProtocolRejection(
      new TauriXcom2ProjectFoundryAdapter().resolvePinnedObject(sourceGrant()),
      commands.resolveSourceObject,
      "response",
    );

    expect(getter).not.toHaveBeenCalled();
    expect(error.message).not.toContain("/private/provider/SECRET-PATH");
    expect(error.cause).toBeUndefined();
  });
});

describe("Project Foundry corrected renderer commands and parent-only selection", () => {
  it("publishes the exact frozen corrected renderer command vocabulary", () => {
    expect(rendererCommands).toEqual({
      authorizeDestinationParentSelection:
        "authorize_xcom2_project_foundry_destination_parent_selection",
      renderPreview: "render_xcom2_project_foundry_preview",
      revokeOperation: "revoke_xcom2_project_foundry_operation_grants",
    });
    expect(Object.isFrozen(rendererCommands)).toBe(true);
    expect(Reflect.set(rendererCommands, "renderPreview", "unsafe")).toBe(false);
  });

  it("selects only the destination parent with exact dialog options and invoke args", async () => {
    const events: string[] = [];
    openMock.mockImplementationOnce((options) => {
      events.push("dialog");
      expect(options).toEqual({ directory: true, multiple: false });
      expect(Reflect.ownKeys(options as object)).toEqual(["directory", "multiple"]);
      expect(Object.isFrozen(options)).toBe(true);
      return Promise.resolve("/destination/parent");
    });
    invokeMock.mockImplementationOnce((command, args) => {
      events.push("invoke");
      expect(command).toBe(rendererCommands.authorizeDestinationParentSelection);
      expect(args).toEqual({ request: { selectedRoot: "/destination/parent" } });
      expect(Reflect.ownKeys(args as object)).toEqual(["request"]);
      expect(Reflect.ownKeys((args as { request: object }).request)).toEqual(["selectedRoot"]);
      expect(Object.isFrozen(args)).toBe(true);
      expect(Object.isFrozen((args as { request: object }).request)).toBe(true);
      return Promise.resolve(destinationGrant());
    });

    const result = await new TauriXcom2ProjectFoundryRendererAdapter().selectDestinationParent();

    expect(events).toEqual(["dialog", "invoke"]);
    expect(openMock).toHaveBeenCalledExactlyOnceWith({ directory: true, multiple: false });
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith(
      rendererCommands.authorizeDestinationParentSelection,
      { request: { selectedRoot: "/destination/parent" } },
    );
    expect(result).toEqual(destinationGrant());
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("rejects a parent grant not bound to the selected parent", async () => {
    openMock.mockResolvedValueOnce("/destination/parent");
    invokeMock.mockResolvedValueOnce(destinationGrant({ parent: "/destination/other" }));

    await expectProtocolRejection(
      new TauriXcom2ProjectFoundryRendererAdapter().selectDestinationParent(),
      rendererCommands.authorizeDestinationParentSelection,
      "response",
    );
  });

  it("reports destination cancellation without invoking parent authorization", async () => {
    openMock.mockResolvedValueOnce(null);

    const error = await captureRejection(
      new TauriXcom2ProjectFoundryRendererAdapter().selectDestinationParent(),
    );

    expect(error).toMatchObject({
      name: "TauriProjectFoundrySelectionCancelledError",
      message: "Native directory selection was cancelled",
      selection: "destination-parent",
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe("Project Foundry corrected render request, result, refusal, and bindings", () => {
  it("invokes the exact render command with only a detached strict request", async () => {
    const caller = renderRequest();
    invokeMock.mockImplementationOnce((command, args) => {
      expect(command).toBe(rendererCommands.renderPreview);
      expect(args).toEqual({ request: renderRequest() });
      expect(Reflect.ownKeys(args as object)).toEqual(["request"]);
      const request = (args as { request: Xcom2ProjectFoundryRenderRequest }).request;
      expect(Reflect.ownKeys(request)).toEqual(["sourceGrant", "destinationParentGrant", "modId"]);
      expect(request).not.toBe(caller);
      expect(request.sourceGrant).not.toBe(caller.sourceGrant);
      expect(request.destinationParentGrant).not.toBe(caller.destinationParentGrant);
      expect(Object.isFrozen(args)).toBe(true);
      expect(Object.isFrozen(request)).toBe(true);
      expect(Object.isFrozen(request.sourceGrant)).toBe(true);
      expect(Object.isFrozen(request.destinationParentGrant)).toBe(true);
      return Promise.resolve(renderedResult());
    });

    await expect(
      new TauriXcom2ProjectFoundryRendererAdapter().renderPreview(caller),
    ).resolves.toEqual(renderedResult());

    expect(invokeMock).toHaveBeenCalledExactlyOnceWith(rendererCommands.renderPreview, {
      request: renderRequest(),
    });
    expect(openMock).not.toHaveBeenCalled();
  });

  it.each(XCOM2_PROJECT_FOUNDRY_REFUSAL_CODES)(
    "accepts and freezes exact renderer refusal %s",
    async (code) => {
      const provider = { kind: "refused", code };
      invokeMock.mockResolvedValueOnce(provider);

      const result = await new TauriXcom2ProjectFoundryRendererAdapter().renderPreview(
        renderRequest(),
      );

      expect(result).toEqual({ kind: "refused", code });
      expect(result).not.toBe(provider);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Reflect.ownKeys(result)).toEqual(["kind", "code"]);
    },
  );

  it.each([
    ["null", null],
    ["array", []],
    ["primitive", "rendered"],
    ["missing kind", { operationGrant: operationGrant(), planBody: {} }],
    ["unknown kind", { kind: "ready", operationGrant: operationGrant(), planBody: {} }],
    ["rendered missing plan body", { kind: "rendered", operationGrant: operationGrant() }],
    ["rendered extra top-level key", { ...renderedResult(), providerPath: "/private/provider" }],
    ["refusal missing code", { kind: "refused" }],
    ["refusal extra top-level key", { kind: "refused", code: "mod-id-invalid", detail: "raw" }],
    ["unsupported refusal", { kind: "refused", code: "provider-secret" }],
    ["class instance", Object.assign(new (class NativeResult {})(), renderedResult())],
  ])("rejects inexact render response: %s", async (_label, response) => {
    invokeMock.mockResolvedValueOnce(response);
    await expectProtocolRejection(
      new TauriXcom2ProjectFoundryRendererAdapter().renderPreview(renderRequest()),
      rendererCommands.renderPreview,
      "response",
    );
  });

  it.each([
    ["missing destination grant", { sourceGrant: sourceGrant(), modId }],
    ["extra operation authority", { ...renderRequest(), operationGrant: operationGrant() }],
    ["extra source evidence", { ...renderRequest(), sourceObject: evidence() }],
    ["extra destination state", { ...renderRequest(), destinationState: "absent" }],
    [
      "same source and destination identity",
      renderRequest({ destinationParentGrant: destinationGrant({ identity: "source-grant:1" }) }),
    ],
    ["invalid source grant", renderRequest({ sourceGrant: sourceGrant({ kind: "other" }) })],
    [
      "invalid destination grant",
      renderRequest({ destinationParentGrant: destinationGrant({ parent: "relative" }) }),
    ],
    ["invalid ModId", renderRequest({ modId: "1Invalid" })],
    ["class request", Object.assign(new (class RenderRequest {})(), renderRequest())],
  ])(
    "rejects render request or source/destination binding mismatch: %s",
    async (_label, request) => {
      await expectProtocolRejection(
        new TauriXcom2ProjectFoundryRendererAdapter().renderPreview(
          request as Xcom2ProjectFoundryRenderRequest,
        ),
        rendererCommands.renderPreview,
        "request",
      );
      expect(invokeMock).not.toHaveBeenCalled();
    },
  );

  it("does not execute an accessor-backed render request field", async () => {
    const getter = vi.fn(() => "/private/provider/SECRET-PATH");
    const request = renderRequest() as unknown as Record<string, unknown>;
    Object.defineProperty(request, "modId", { enumerable: true, get: getter });

    const error = await expectProtocolRejection(
      new TauriXcom2ProjectFoundryRendererAdapter().renderPreview(
        request as unknown as Xcom2ProjectFoundryRenderRequest,
      ),
      rendererCommands.renderPreview,
      "request",
    );

    expect(getter).not.toHaveBeenCalled();
    expect(error.message).not.toContain("SECRET-PATH");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong derived destination", operationGrant({ derivedDestination: "/destination/other" })],
    ["operation identity equals source", operationGrant({ identity: "source-grant:1" })],
    ["operation identity equals destination", operationGrant({ identity: "destination-grant:1" })],
  ])("rejects rendered operation binding mismatch: %s", async (_label, grant) => {
    invokeMock.mockResolvedValueOnce(renderedResult({}, grant));
    await expectProtocolRejection(
      new TauriXcom2ProjectFoundryRendererAdapter().renderPreview(renderRequest()),
      rendererCommands.renderPreview,
      "response",
    );
  });
});

describe("Project Foundry bounded strict unknown JSON render plan", () => {
  it("preserves arbitrary extra plan keys and every supported JSON value kind", async () => {
    const planBody = {
      schemaVersion: 1,
      providerNeutralExtension: {
        nullValue: null,
        booleanValue: true,
        numberValue: -12.5,
        stringValue: "safe text 🧪",
        arrayValue: [false, 0, "value", { nested: "accepted" }],
      },
    };
    invokeMock.mockResolvedValueOnce(renderedResult(planBody));

    const result = await new TauriXcom2ProjectFoundryRendererAdapter().renderPreview(
      renderRequest(),
    );

    expect(result).toEqual(renderedResult(planBody));
    expect(result.kind).toBe("rendered");
    if (result.kind === "rendered") {
      expect(result.planBody).toEqual(planBody);
      expect(result.planBody).not.toBe(planBody);
    }
  });

  it.each([
    ["undefined", { value: undefined }],
    ["function", () => undefined],
    ["symbol", Symbol("native")],
    ["bigint", BigInt(1)],
    ["NaN", Number.NaN],
    ["positive infinity", Number.POSITIVE_INFINITY],
    ["negative infinity", Number.NEGATIVE_INFINITY],
    ["date", new Date(0)],
    ["class instance", new (class NativePlan {})()],
  ])("rejects non-JSON plan body value: %s", async (_label, planBody) => {
    invokeMock.mockResolvedValueOnce(renderedResult(planBody));
    await expectProtocolRejection(
      new TauriXcom2ProjectFoundryRendererAdapter().renderPreview(renderRequest()),
      rendererCommands.renderPreview,
      "response",
    );
  });

  it.each([
    ["C0 control", "unsafe\u0000text"],
    ["C1 control", "unsafe\u009ftext"],
    ["lone high surrogate", "unsafe\ud800text"],
    ["terminal high surrogate", "unsafe\ud800"],
    ["lone low surrogate", "unsafe\udc00text"],
    ["terminal low surrogate", "unsafe\udc00"],
  ])("rejects unsafe plan string: %s", async (_label, value) => {
    invokeMock.mockResolvedValueOnce(renderedResult({ value }));
    await expectProtocolRejection(
      new TauriXcom2ProjectFoundryRendererAdapter().renderPreview(renderRequest()),
      rendererCommands.renderPreview,
      "response",
    );
  });

  it("rejects unsafe string and symbol field names", async () => {
    const unsafeNames = ["control\u0000key", "surrogate\ud800", Symbol("native-secret")];
    for (const key of unsafeNames) {
      const planBody: Record<PropertyKey, unknown> = { safe: true };
      Object.defineProperty(planBody, key, { enumerable: true, value: "value" });
      invokeMock.mockResolvedValueOnce(renderedResult(planBody));
      await expectProtocolRejection(
        new TauriXcom2ProjectFoundryRendererAdapter().renderPreview(renderRequest()),
        rendererCommands.renderPreview,
        "response",
      );
    }
  });

  it("rejects plan accessors without executing them or leaking their value", async () => {
    const getter = vi.fn(() => "/private/provider/SECRET-PATH");
    const planBody = { safe: true };
    Object.defineProperty(planBody, "providerPath", { enumerable: true, get: getter });
    invokeMock.mockResolvedValueOnce(renderedResult(planBody));

    const error = await expectProtocolRejection(
      new TauriXcom2ProjectFoundryRendererAdapter().renderPreview(renderRequest()),
      rendererCommands.renderPreview,
      "response",
    );

    expect(getter).not.toHaveBeenCalled();
    expect(error.message).not.toContain("SECRET-PATH");
    expect(error.cause).toBeUndefined();
  });

  it("rejects hidden plan fields", async () => {
    const planBody = { safe: true };
    Object.defineProperty(planBody, "providerPath", {
      enumerable: false,
      value: "/private/provider/SECRET-PATH",
    });
    invokeMock.mockResolvedValueOnce(renderedResult(planBody));

    await expectProtocolRejection(
      new TauriXcom2ProjectFoundryRendererAdapter().renderPreview(renderRequest()),
      rendererCommands.renderPreview,
      "response",
    );
  });

  it("rejects cyclic plan objects", async () => {
    const planBody: Record<string, unknown> = {};
    planBody.self = planBody;
    invokeMock.mockResolvedValueOnce(renderedResult(planBody));

    await expectProtocolRejection(
      new TauriXcom2ProjectFoundryRendererAdapter().renderPreview(renderRequest()),
      rendererCommands.renderPreview,
      "response",
    );
  });

  it("rejects sparse, accessor-backed, and extra-property arrays", async () => {
    const sparse = Array(2);
    sparse[1] = "present";
    const getter = vi.fn(() => "/private/provider/SECRET-PATH");
    const accessor = ["safe"];
    Object.defineProperty(accessor, "0", { enumerable: true, get: getter });
    const extra = ["safe"];
    Object.defineProperty(extra, "providerPath", { enumerable: true, value: "secret" });

    for (const planBody of [sparse, accessor, extra]) {
      invokeMock.mockResolvedValueOnce(renderedResult(planBody));
      await expectProtocolRejection(
        new TauriXcom2ProjectFoundryRendererAdapter().renderPreview(renderRequest()),
        rendererCommands.renderPreview,
        "response",
      );
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it("accepts depth 32 and rejects depth 33", async () => {
    invokeMock.mockResolvedValueOnce(renderedResult(nestedJson(32)));
    await expect(
      new TauriXcom2ProjectFoundryRendererAdapter().renderPreview(renderRequest()),
    ).resolves.toMatchObject({ kind: "rendered" });

    invokeMock.mockResolvedValueOnce(renderedResult(nestedJson(33)));
    await expectProtocolRejection(
      new TauriXcom2ProjectFoundryRendererAdapter().renderPreview(renderRequest()),
      rendererCommands.renderPreview,
      "response",
    );
  });

  it("accepts exactly 10000 JSON nodes and rejects 10001", async () => {
    invokeMock.mockResolvedValueOnce(renderedResult(nodeBoundPlan()));
    await expect(
      new TauriXcom2ProjectFoundryRendererAdapter().renderPreview(renderRequest()),
    ).resolves.toMatchObject({ kind: "rendered" });

    invokeMock.mockResolvedValueOnce(renderedResult(nodeBoundPlan(1)));
    await expectProtocolRejection(
      new TauriXcom2ProjectFoundryRendererAdapter().renderPreview(renderRequest()),
      rendererCommands.renderPreview,
      "response",
    );
  });

  it("enforces array length and object field bounds", async () => {
    const maximumArray = Array(4_096).fill(null);
    const maximumObject = Object.fromEntries(
      Array.from({ length: 256 }, (_, index) => [`field${index}`, null]),
    );
    invokeMock
      .mockResolvedValueOnce(renderedResult(maximumArray))
      .mockResolvedValueOnce(renderedResult(maximumObject));
    await expect(
      new TauriXcom2ProjectFoundryRendererAdapter().renderPreview(renderRequest()),
    ).resolves.toMatchObject({ kind: "rendered" });
    await expect(
      new TauriXcom2ProjectFoundryRendererAdapter().renderPreview(renderRequest()),
    ).resolves.toMatchObject({ kind: "rendered" });

    invokeMock
      .mockResolvedValueOnce(renderedResult(Array(4_097).fill(null)))
      .mockResolvedValueOnce(
        renderedResult(
          Object.fromEntries(Array.from({ length: 257 }, (_, index) => [`field${index}`, null])),
        ),
      );
    await expectProtocolRejection(
      new TauriXcom2ProjectFoundryRendererAdapter().renderPreview(renderRequest()),
      rendererCommands.renderPreview,
      "response",
    );
    await expectProtocolRejection(
      new TauriXcom2ProjectFoundryRendererAdapter().renderPreview(renderRequest()),
      rendererCommands.renderPreview,
      "response",
    );
  });

  it("enforces per-key and per-string byte bounds", async () => {
    const maximumKey = "k".repeat(256);
    const maximumString = "s".repeat(1_048_576);
    invokeMock
      .mockResolvedValueOnce(renderedResult({ [maximumKey]: true }))
      .mockResolvedValueOnce(renderedResult(maximumString));
    await expect(
      new TauriXcom2ProjectFoundryRendererAdapter().renderPreview(renderRequest()),
    ).resolves.toMatchObject({ kind: "rendered" });
    await expect(
      new TauriXcom2ProjectFoundryRendererAdapter().renderPreview(renderRequest()),
    ).resolves.toMatchObject({ kind: "rendered" });

    invokeMock
      .mockResolvedValueOnce(renderedResult({ ["k".repeat(257)]: true }))
      .mockResolvedValueOnce(renderedResult("s".repeat(1_048_577)));
    await expectProtocolRejection(
      new TauriXcom2ProjectFoundryRendererAdapter().renderPreview(renderRequest()),
      rendererCommands.renderPreview,
      "response",
    );
    await expectProtocolRejection(
      new TauriXcom2ProjectFoundryRendererAdapter().renderPreview(renderRequest()),
      rendererCommands.renderPreview,
      "response",
    );
  });

  it("enforces the aggregate string byte bound including field names", async () => {
    const exactTotal = {
      a: "x".repeat(1_048_576),
      b: "x".repeat(1_048_576),
      c: "x".repeat(1_048_576),
      d: "x".repeat(1_048_572),
    };
    invokeMock.mockResolvedValueOnce(renderedResult(exactTotal));
    await expect(
      new TauriXcom2ProjectFoundryRendererAdapter().renderPreview(renderRequest()),
    ).resolves.toMatchObject({ kind: "rendered" });

    invokeMock.mockResolvedValueOnce(renderedResult({ ...exactTotal, d: "x".repeat(1_048_573) }));
    await expectProtocolRejection(
      new TauriXcom2ProjectFoundryRendererAdapter().renderPreview(renderRequest()),
      rendererCommands.renderPreview,
      "response",
    );
  });
});

describe("Project Foundry corrected renderer copy, freeze, and failure isolation", () => {
  it("copies caller input before invoke and isolates it from later caller mutation", async () => {
    const response = deferred<unknown>();
    const caller = renderRequest();
    let captured: { request: Xcom2ProjectFoundryRenderRequest } | undefined;
    invokeMock.mockImplementationOnce((_command, args) => {
      captured = args as { request: Xcom2ProjectFoundryRenderRequest };
      return response.promise;
    });
    const operation = new TauriXcom2ProjectFoundryRendererAdapter().renderPreview(caller);

    (caller.sourceGrant as unknown as Record<string, unknown>).repository = "/caller/mutated";
    (caller.destinationParentGrant as unknown as Record<string, unknown>).parent =
      "/caller/mutated";
    (caller as unknown as Record<string, unknown>).modId = "CallerMutated";

    expect(captured?.request).toEqual(renderRequest());
    expect(captured?.request).not.toBe(caller);
    expect(Object.isFrozen(captured)).toBe(true);
    expect(Object.isFrozen(captured?.request)).toBe(true);
    expect(Object.isFrozen(captured?.request.sourceGrant)).toBe(true);
    expect(Object.isFrozen(captured?.request.destinationParentGrant)).toBe(true);

    response.resolve(renderedResult());
    await expect(operation).resolves.toEqual(renderedResult());
  });

  it("deeply copies and freezes native rendered data against provider and caller mutation", async () => {
    const providerGrant = operationGrant();
    const providerEntry = { path: "Config/DefaultGame.ini", flags: [true, null] };
    const providerPlan = { entries: [providerEntry], metadata: { version: 1 } };
    const provider = renderedResult(providerPlan, providerGrant);
    invokeMock.mockResolvedValueOnce(provider);

    const result = await new TauriXcom2ProjectFoundryRendererAdapter().renderPreview(
      renderRequest(),
    );
    (providerGrant as unknown as Record<string, unknown>).identity = "provider-mutated";
    providerEntry.path = "/private/provider/SECRET-PATH";
    providerEntry.flags.push(false);
    providerPlan.metadata.version = 2;

    expect(result).toEqual(
      renderedResult({
        entries: [{ path: "Config/DefaultGame.ini", flags: [true, null] }],
        metadata: { version: 1 },
      }),
    );
    expect(result).not.toBe(provider);
    expect(Object.isFrozen(result)).toBe(true);
    if (result.kind === "rendered") {
      const plan = result.planBody as {
        entries: readonly [{ path: string; flags: readonly unknown[] }];
        metadata: { version: number };
      };
      expect(result.operationGrant).not.toBe(providerGrant);
      expect(plan).not.toBe(providerPlan);
      expect(Object.isFrozen(result.operationGrant)).toBe(true);
      expect(Object.isFrozen(plan)).toBe(true);
      expect(Object.isFrozen(plan.entries)).toBe(true);
      expect(Object.isFrozen(plan.entries[0])).toBe(true);
      expect(Object.isFrozen(plan.entries[0].flags)).toBe(true);
      expect(Object.isFrozen(plan.metadata)).toBe(true);
      expect(Reflect.set(plan.entries[0], "path", "/caller/mutated")).toBe(false);
      expect(Reflect.set(plan.metadata, "version", 3)).toBe(false);
    }
  });

  it("sanitizes renderer invoke failures without retaining native details", async () => {
    const failure = {
      message: "renderer failed at /private/provider/SECRET-PATH",
      token: "SECRET-TOKEN",
    };
    invokeMock.mockRejectedValueOnce(failure);

    const error = await captureRejection(
      new TauriXcom2ProjectFoundryRendererAdapter().renderPreview(renderRequest()),
    );

    expect(error).toMatchObject({
      name: "TauriAdapterError",
      command: rendererCommands.renderPreview,
      message: `[tauri:${rendererCommands.renderPreview}] Native Project Foundry command failed`,
      cause: undefined,
    });
    expect(error).not.toBe(failure);
    expect(`${error.message}\n${JSON.stringify(error)}`).not.toContain("SECRET");
    expect(`${error.message}\n${JSON.stringify(error)}`).not.toContain("/private/provider");
  });

  it("surfaces only an allowlisted renderer rejection code without retaining its Error", async () => {
    const failure = new Error("rendered-plan-invalid");
    invokeMock.mockRejectedValueOnce(failure);

    const error = await captureRejection(
      new TauriXcom2ProjectFoundryRendererAdapter().renderPreview(renderRequest()),
    );

    expect(error).toMatchObject({
      name: "TauriAdapterError",
      command: rendererCommands.renderPreview,
      message: `[tauri:${rendererCommands.renderPreview}] Native Project Foundry command rejected: rendered-plan-invalid`,
      cause: undefined,
    });
    expect(error).not.toBe(failure);
  });

  it("fails closed on a hostile render result without leaking its inspection exception", async () => {
    const secret = new Error("SECRET-PROXY:/private/provider/SECRET-PATH");
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf: () => {
          throw secret;
        },
      },
    );
    invokeMock.mockResolvedValueOnce(hostile);

    const error = await expectProtocolRejection(
      new TauriXcom2ProjectFoundryRendererAdapter().renderPreview(renderRequest()),
      rendererCommands.renderPreview,
      "response",
    );

    expect(error.message).toBe(
      `[tauri:${rendererCommands.renderPreview}] Invalid Project Foundry response: render result could not be safely inspected`,
    );
    expect(error.message).not.toContain("SECRET-PROXY");
    expect(error.message).not.toContain("/private/provider");
    expect(error.cause).toBeUndefined();
  });
});

describe("Project Foundry operation revocation and corrected factory composition", () => {
  it("invokes revokeOperation with no args and validates empty acknowledgement", async () => {
    invokeMock.mockResolvedValueOnce(undefined);

    await new TauriXcom2ProjectFoundryRendererAdapter().revokeOperation();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls[0]).toEqual([rendererCommands.revokeOperation, undefined]);
    expect(openMock).not.toHaveBeenCalled();
  });

  it.each([null, undefined])(
    "accepts empty operation revocation acknowledgement %j",
    async (acknowledgement) => {
      invokeMock.mockResolvedValueOnce(acknowledgement);
      await expect(
        new TauriXcom2ProjectFoundryRendererAdapter().revokeOperation(),
      ).resolves.toBeUndefined();
    },
  );

  it.each([false, true, 0, "", "ok", {}, []])(
    "rejects non-empty operation revocation acknowledgement %j",
    async (acknowledgement) => {
      invokeMock.mockResolvedValueOnce(acknowledgement);
      await expectProtocolRejection(
        new TauriXcom2ProjectFoundryRendererAdapter().revokeOperation(),
        rendererCommands.revokeOperation,
        "response",
      );
    },
  );

  it("preserves revokeAll alongside operation revocation on the frozen grants facet", async () => {
    invokeMock.mockResolvedValueOnce(null).mockResolvedValueOnce(undefined);
    const composition = createTauriXcom2ProjectFoundryRendererComposition();

    expect(Reflect.ownKeys(composition.grants)).toEqual(["revokeOperation", "revokeAll"]);
    expect(Object.isFrozen(composition.grants)).toBe(true);
    await composition.grants.revokeOperation();
    await composition.grants.revokeAll();

    expect(invokeMock.mock.calls).toEqual([
      [rendererCommands.revokeOperation, undefined],
      [commands.revokeAll, undefined],
    ]);
    expect(typeof composition.selectors.selectSourceRepository).toBe("function");
    expect(typeof composition.selectors.selectDestinationParent).toBe("function");
    expect(typeof composition.renderer.renderPreview).toBe("function");
  });

  it("wires corrected factories, aliases, frozen facets, and parent-only API", async () => {
    const composition = createTauriXcom2ProjectFoundryRendererComposition();
    const aliasComposition = createTauriProjectFoundryRendererComposition();

    expect(composition).toBeInstanceOf(TauriXcom2ProjectFoundryRendererAdapter);
    expect(composition).toBeInstanceOf(TauriProjectFoundryRendererAdapter);
    expect(aliasComposition).toBeInstanceOf(TauriXcom2ProjectFoundryRendererAdapter);
    expect(new TauriProjectFoundryRendererAdapter()).toBeInstanceOf(
      TauriXcom2ProjectFoundryRendererAdapter,
    );
    expect(Reflect.ownKeys(composition.selectors)).toEqual([
      "selectSourceRepository",
      "selectDestinationParent",
    ]);
    expect(Reflect.ownKeys(composition.renderer)).toEqual(["renderPreview"]);
    for (const facet of [composition.selectors, composition.renderer, composition.grants]) {
      expect(Object.isFrozen(facet)).toBe(true);
    }

    openMock
      .mockResolvedValueOnce("/source/repository")
      .mockResolvedValueOnce("/destination/parent");
    invokeMock
      .mockResolvedValueOnce(sourceGrant())
      .mockResolvedValueOnce(destinationGrant())
      .mockResolvedValueOnce(renderedResult());

    await expect(composition.selectors.selectSourceRepository()).resolves.toEqual(sourceGrant());
    await expect(composition.selectors.selectDestinationParent()).resolves.toEqual(
      destinationGrant(),
    );
    await expect(composition.renderer.renderPreview(renderRequest())).resolves.toEqual(
      renderedResult(),
    );
    expect(invokeMock.mock.calls).toEqual([
      [commands.authorizeSourceRepository, { request: { selectedRoot: "/source/repository" } }],
      [
        rendererCommands.authorizeDestinationParentSelection,
        { request: { selectedRoot: "/destination/parent" } },
      ],
      [rendererCommands.renderPreview, { request: renderRequest() }],
    ]);
  });
});

describe("Project Foundry Apply exact command, request custody, and pass-through", () => {
  it("publishes and invokes the exact Apply command with only a detached immutable request", async () => {
    const caller = applyRequest();
    invokeMock.mockImplementationOnce((command, args) => {
      expect(command).toBe("apply_xcom2_project_foundry");
      expect(command).toBe(XCOM2_PROJECT_FOUNDRY_APPLY_COMMAND);
      expect(Reflect.ownKeys(args as object)).toEqual(["request"]);
      const immutable = (args as { request: Xcom2ProjectFoundryApplyRequest }).request;
      expect(Reflect.ownKeys(immutable)).toEqual([
        "schemaVersion",
        "sourceGrant",
        "destinationParentGrant",
        "operationGrant",
        "modId",
        "approvedPlanDigest",
      ]);
      expect(immutable).toEqual(applyRequest());
      expect(immutable).not.toBe(caller);
      expect(immutable.sourceGrant).not.toBe(caller.sourceGrant);
      expect(immutable.destinationParentGrant).not.toBe(caller.destinationParentGrant);
      expect(immutable.operationGrant).not.toBe(caller.operationGrant);
      expect(Object.isFrozen(args)).toBe(true);
      expect(Object.isFrozen(immutable)).toBe(true);
      expect(Object.isFrozen(immutable.sourceGrant)).toBe(true);
      expect(Object.isFrozen(immutable.destinationParentGrant)).toBe(true);
      expect(Object.isFrozen(immutable.operationGrant)).toBe(true);
      expect(Reflect.set(immutable, "modId", "ProviderMutated")).toBe(false);
      expect(Reflect.set(immutable.operationGrant, "identity", "provider-mutated")).toBe(false);
      return Promise.resolve(createdReceipt());
    });

    await expect(new TauriXcom2ProjectFoundryRendererAdapter().apply(caller)).resolves.toEqual(
      createdReceipt(),
    );

    expect(invokeMock).toHaveBeenCalledExactlyOnceWith(XCOM2_PROJECT_FOUNDRY_APPLY_COMMAND, {
      request: applyRequest(),
    });
    expect(openMock).not.toHaveBeenCalled();
  });

  it("snapshots caller data before pending native work and ignores later caller mutation", async () => {
    const native = deferred<unknown>();
    const caller = applyRequest();
    let captured: Xcom2ProjectFoundryApplyRequest | undefined;
    invokeMock.mockImplementationOnce((_command, args) => {
      captured = (args as { request: Xcom2ProjectFoundryApplyRequest }).request;
      return native.promise;
    });

    const pending = new TauriXcom2ProjectFoundryRendererAdapter().apply(caller);
    (caller.sourceGrant as unknown as Record<string, unknown>).repository = "/caller/mutated";
    (caller.destinationParentGrant as unknown as Record<string, unknown>).parent =
      "/caller/mutated";
    (caller.operationGrant as unknown as Record<string, unknown>).derivedDestination =
      "/caller/mutated/Other";
    (caller as unknown as Record<string, unknown>).approvedPlanDigest = "f".repeat(64);

    expect(captured).toEqual(applyRequest());
    native.resolve(createdReceipt());
    await expect(pending).resolves.toEqual(createdReceipt());
  });

  it("passes concurrent one-shot attempts through independently without cross-binding results", async () => {
    const firstNative = deferred<unknown>();
    const secondNative = deferred<unknown>();
    invokeMock
      .mockImplementationOnce(() => firstNative.promise)
      .mockImplementationOnce(() => secondNative.promise);
    const adapter = new TauriXcom2ProjectFoundryRendererAdapter();

    const first = adapter.apply(applyRequest());
    const second = adapter.apply(applyRequest());
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));
    secondNative.resolve({
      result: "refused",
      phase: "pre-commit",
      reason: "apply-authority-consumed",
    });
    await expect(second).resolves.toEqual({
      result: "refused",
      phase: "pre-commit",
      reason: "apply-authority-consumed",
    });
    firstNative.resolve(createdReceipt());
    await expect(first).resolves.toEqual(createdReceipt());

    expect(invokeMock.mock.calls).toEqual([
      [XCOM2_PROJECT_FOUNDRY_APPLY_COMMAND, { request: applyRequest() }],
      [XCOM2_PROJECT_FOUNDRY_APPLY_COMMAND, { request: applyRequest() }],
    ]);
  });
});

describe("Project Foundry Apply strict request DTO validation", () => {
  it.each([
    ["null", null],
    ["array", []],
    ["primitive", "apply"],
    ["class instance", Object.assign(new (class ApplyRequest {})(), applyRequest())],
    [
      "missing schemaVersion",
      (() => {
        const value = applyRequest() as unknown as Record<string, unknown>;
        delete value.schemaVersion;
        return value;
      })(),
    ],
    [
      "missing sourceGrant",
      (() => {
        const value = applyRequest() as unknown as Record<string, unknown>;
        delete value.sourceGrant;
        return value;
      })(),
    ],
    [
      "missing destinationParentGrant",
      (() => {
        const value = applyRequest() as unknown as Record<string, unknown>;
        delete value.destinationParentGrant;
        return value;
      })(),
    ],
    [
      "missing operationGrant",
      (() => {
        const value = applyRequest() as unknown as Record<string, unknown>;
        delete value.operationGrant;
        return value;
      })(),
    ],
    [
      "missing modId",
      (() => {
        const value = applyRequest() as unknown as Record<string, unknown>;
        delete value.modId;
        return value;
      })(),
    ],
    [
      "missing approvedPlanDigest",
      (() => {
        const value = applyRequest() as unknown as Record<string, unknown>;
        delete value.approvedPlanDigest;
        return value;
      })(),
    ],
    ["extra source-object claim", applyRequest({ sourceObject: evidence() })],
    ["extra destination-state claim", applyRequest({ destinationState: "absent" })],
    ["extra output manifest", applyRequest({ manifest: [] })],
    ["extra rendered bytes", applyRequest({ bytes: "provider-owned" })],
    ["extra receipt", applyRequest({ receipt: createdReceipt() })],
    ["extra success assertion", applyRequest({ success: true })],
  ])("rejects an inexact Apply request before invoke: %s", async (_label, request) => {
    await expectProtocolRejection(
      new TauriXcom2ProjectFoundryRendererAdapter().apply(
        request as Xcom2ProjectFoundryApplyRequest,
      ),
      XCOM2_PROJECT_FOUNDRY_APPLY_COMMAND,
      "request",
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong schema version", applyRequest({ schemaVersion: 2 })],
    ["string schema version", applyRequest({ schemaVersion: "1" })],
    ["malformed source grant", applyRequest({ sourceGrant: sourceGrant({ kind: "other" }) })],
    [
      "source path control",
      applyRequest({ sourceGrant: sourceGrant({ repository: "/source/secret\u0000" }) }),
    ],
    [
      "source path surrogate",
      applyRequest({ sourceGrant: sourceGrant({ repository: "/source/\ud800" }) }),
    ],
    [
      "source path oversized",
      applyRequest({ sourceGrant: sourceGrant({ repository: `/${"s".repeat(4_096)}` }) }),
    ],
    [
      "malformed destination grant",
      applyRequest({ destinationParentGrant: destinationGrant({ parent: "relative" }) }),
    ],
    [
      "malformed operation grant",
      applyRequest({ operationGrant: operationGrant({ kind: "other" }) }),
    ],
    [
      "operation path control",
      applyRequest({
        operationGrant: operationGrant({ derivedDestination: `/destination/parent/${modId}\n` }),
      }),
    ],
    [
      "operation path surrogate",
      applyRequest({
        operationGrant: operationGrant({ derivedDestination: "/destination/parent/Foundry\udc00" }),
      }),
    ],
    [
      "operation path oversized",
      applyRequest({
        operationGrant: operationGrant({ derivedDestination: `/${"d".repeat(4_096)}` }),
      }),
    ],
    ["invalid ModId", applyRequest({ modId: "1Invalid" })],
    ["ModId control", applyRequest({ modId: "Foundry\n" })],
    ["ModId surrogate", applyRequest({ modId: "Foundry\ud800" })],
    ["ModId oversized", applyRequest({ modId: `A${"b".repeat(48)}` })],
    ["digest is not lowercase SHA-256", applyRequest({ approvedPlanDigest: "F".repeat(64) })],
    ["digest malformed", applyRequest({ approvedPlanDigest: "g".repeat(64) })],
    ["digest control", applyRequest({ approvedPlanDigest: `${"a".repeat(63)}\n` })],
    ["digest surrogate", applyRequest({ approvedPlanDigest: `${"a".repeat(63)}\ud800` })],
    ["digest oversized", applyRequest({ approvedPlanDigest: "a".repeat(65) })],
    [
      "derived destination does not bind parent and ModId",
      applyRequest({
        operationGrant: operationGrant({ derivedDestination: "/destination/parent/Other" }),
      }),
    ],
    [
      "source and destination identities collide",
      applyRequest({ destinationParentGrant: destinationGrant({ identity: "source-grant:1" }) }),
    ],
    [
      "source and operation identities collide",
      applyRequest({ operationGrant: operationGrant({ identity: "source-grant:1" }) }),
    ],
    [
      "destination and operation identities collide",
      applyRequest({ operationGrant: operationGrant({ identity: "destination-grant:1" }) }),
    ],
  ])("rejects malformed Apply field or binding: %s", async (_label, request) => {
    await expectProtocolRejection(
      new TauriXcom2ProjectFoundryRendererAdapter().apply(request),
      XCOM2_PROJECT_FOUNDRY_APPLY_COMMAND,
      "request",
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("rejects hidden, symbol, accessor, and proxy request data without inspection leakage", async () => {
    const hidden = hiddenExtra(applyRequest(), "providerPath");
    const symbol = applyRequest() as unknown as Record<PropertyKey, unknown>;
    Object.defineProperty(symbol, Symbol("provider-secret"), { value: "SECRET" });
    const getter = vi.fn(() => "SECRET-ACCESSOR:/private/provider");
    const accessor = applyRequest() as unknown as Record<string, unknown>;
    Object.defineProperty(accessor, "approvedPlanDigest", { enumerable: true, get: getter });
    const secret = new Error("SECRET-PROXY:/private/provider");
    const proxy = new Proxy(applyRequest(), {
      getPrototypeOf: () => {
        throw secret;
      },
    });

    for (const request of [hidden, symbol, accessor, proxy]) {
      const error = await expectProtocolRejection(
        new TauriXcom2ProjectFoundryRendererAdapter().apply(
          request as Xcom2ProjectFoundryApplyRequest,
        ),
        XCOM2_PROJECT_FOUNDRY_APPLY_COMMAND,
        "request",
      );
      expect(error.message).not.toContain("SECRET");
      expect(error.message).not.toContain("/private/provider");
      expect(error.cause).toBeUndefined();
      expect(invokeMock).not.toHaveBeenCalled();
    }
    expect(getter).not.toHaveBeenCalled();
  });
});

describe("Project Foundry Apply exact result vocabularies and immutable receipts", () => {
  it("accepts only the exact created receipt and returns a detached frozen snapshot", async () => {
    const provider = createdReceipt();
    invokeMock.mockResolvedValueOnce(provider);

    const result = await new TauriXcom2ProjectFoundryRendererAdapter().apply(applyRequest());
    provider.planDigest = "f".repeat(64);
    provider.finalProjectLocation = "/provider/mutated";
    provider.committedFiles = 0;

    expect(result).toEqual(createdReceipt());
    expect(result).not.toBe(provider);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Reflect.ownKeys(result)).toEqual([
      "result",
      "planDigest",
      "finalProjectLocation",
      "sourceCommit",
      "sourceTree",
      "committedDirectories",
      "committedFiles",
    ]);
    expect(Reflect.set(result, "committedFiles", 0)).toBe(false);
  });

  it.each(applyRefusalReasons)("accepts exact pre-commit refusal reason %s", async (reason) => {
    const provider = { result: "refused", phase: "pre-commit", reason };
    invokeMock.mockResolvedValueOnce(provider);

    const result = await new TauriXcom2ProjectFoundryRendererAdapter().apply(applyRequest());

    expect(result).toEqual(provider);
    expect(result).not.toBe(provider);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Reflect.ownKeys(result)).toEqual(["result", "phase", "reason"]);
  });

  it.each(applyFailureFixtures)(
    "accepts exact pre-commit failure reason %s with cleanup status %s",
    async (reason, cleanupStatus) => {
      const expected = { result: "failed", phase: "pre-commit", reason, cleanupStatus };
      const provider: Record<string, unknown> = { ...expected };
      invokeMock.mockResolvedValueOnce(provider);

      const result = await new TauriXcom2ProjectFoundryRendererAdapter().apply(applyRequest());
      provider.reason = "provider-mutated";
      provider.cleanupStatus = "provider-mutated";

      expect(result).toEqual(expected);
      expect(result).not.toBe(provider);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Reflect.ownKeys(result)).toEqual(["result", "phase", "reason", "cleanupStatus"]);
      expect(Reflect.set(result, "cleanupStatus", "provider-mutated")).toBe(false);
    },
  );

  it.each(applyPostCommitFailureReasons)(
    "accepts exact post-commit recovery reason %s",
    async (reason) => {
      const provider = {
        result: "created-recovery-required",
        phase: "post-commit",
        planDigest: approvedPlanDigest,
        finalProjectLocation: `/destination/parent/${modId}`,
        reason,
      };
      invokeMock.mockResolvedValueOnce(provider);

      const result = await new TauriXcom2ProjectFoundryRendererAdapter().apply(applyRequest());

      expect(result).toEqual(provider);
      expect(result).not.toBe(provider);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Reflect.ownKeys(result)).toEqual([
        "result",
        "phase",
        "planDigest",
        "finalProjectLocation",
        "reason",
      ]);
    },
  );
});

describe("Project Foundry Apply rejects malformed native results", () => {
  it.each([
    ["null", null],
    ["array", []],
    ["primitive", "created"],
    ["missing result", { planDigest: approvedPlanDigest }],
    ["unsupported result", { result: "success" }],
    ["class instance", Object.assign(new (class ApplyResult {})(), createdReceipt())],
    [
      "created missing digest",
      (() => {
        const value = createdReceipt();
        delete value.planDigest;
        return value;
      })(),
    ],
    [
      "created missing path",
      (() => {
        const value = createdReceipt();
        delete value.finalProjectLocation;
        return value;
      })(),
    ],
    [
      "created missing source commit",
      (() => {
        const value = createdReceipt();
        delete value.sourceCommit;
        return value;
      })(),
    ],
    [
      "created missing source tree",
      (() => {
        const value = createdReceipt();
        delete value.sourceTree;
        return value;
      })(),
    ],
    [
      "created missing directory count",
      (() => {
        const value = createdReceipt();
        delete value.committedDirectories;
        return value;
      })(),
    ],
    [
      "created missing file count",
      (() => {
        const value = createdReceipt();
        delete value.committedFiles;
        return value;
      })(),
    ],
    ["created extra mode", createdReceipt({ mode: "0755" })],
    ["created extra hash", createdReceipt({ hash: approvedPlanDigest })],
    ["created extra path", createdReceipt({ providerPath: "/private/provider" })],
    ["created wrong plan digest", createdReceipt({ planDigest: "f".repeat(64) })],
    [
      "created uppercase plan digest",
      createdReceipt({ planDigest: approvedPlanDigest.toUpperCase() }),
    ],
    [
      "created wrong final path",
      createdReceipt({ finalProjectLocation: "/destination/parent/Other" }),
    ],
    [
      "created relative final path",
      createdReceipt({ finalProjectLocation: "destination/relative" }),
    ],
    [
      "created path control",
      createdReceipt({ finalProjectLocation: `/destination/parent/${modId}\n` }),
    ],
    [
      "created path surrogate",
      createdReceipt({ finalProjectLocation: "/destination/parent/Foundry\ud800" }),
    ],
    ["created path oversized", createdReceipt({ finalProjectLocation: `/${"p".repeat(4_096)}` })],
    ["created wrong source commit", createdReceipt({ sourceCommit: "0".repeat(40) })],
    ["created malformed source commit", createdReceipt({ sourceCommit: 1 })],
    ["created wrong source tree", createdReceipt({ sourceTree: "f".repeat(40) })],
    ["created malformed source tree", createdReceipt({ sourceTree: null })],
    ["created wrong directory count", createdReceipt({ committedDirectories: 11 })],
    ["created fractional directory count", createdReceipt({ committedDirectories: 12.5 })],
    ["created string directory count", createdReceipt({ committedDirectories: "12" })],
    ["created wrong file count", createdReceipt({ committedFiles: 26 })],
    ["created fractional file count", createdReceipt({ committedFiles: 27.5 })],
    ["created string file count", createdReceipt({ committedFiles: "27" })],
    [
      "refusal extra field",
      { result: "refused", phase: "pre-commit", reason: "source-stale", detail: "SECRET" },
    ],
    ["refusal missing phase", { result: "refused", reason: "source-stale" }],
    ["refusal wrong phase", { result: "refused", phase: "post-commit", reason: "source-stale" }],
    [
      "refusal unknown reason",
      { result: "refused", phase: "pre-commit", reason: "provider-secret" },
    ],
    [
      "refusal failure reason",
      { result: "refused", phase: "pre-commit", reason: "stage-write-failed" },
    ],
    [
      "failure missing reason",
      { result: "failed", phase: "pre-commit", cleanupStatus: "verified-complete" },
    ],
    [
      "failure missing cleanup status",
      { result: "failed", phase: "pre-commit", reason: "stage-write-failed" },
    ],
    [
      "failure extra field",
      {
        result: "failed",
        phase: "pre-commit",
        reason: "stage-write-failed",
        cleanupStatus: "verified-complete",
        detail: "SECRET",
      },
    ],
    [
      "failure wrong phase",
      {
        result: "failed",
        phase: "post-commit",
        reason: "stage-write-failed",
        cleanupStatus: "verified-complete",
      },
    ],
    [
      "failure refusal reason",
      {
        result: "failed",
        phase: "pre-commit",
        reason: "source-stale",
        cleanupStatus: "verified-complete",
      },
    ],
    [
      "failure post-commit-only reason",
      {
        result: "failed",
        phase: "pre-commit",
        reason: "post-commit-journal-failed",
        cleanupStatus: "verified-complete",
      },
    ],
    [
      "failure unknown cleanup status",
      {
        result: "failed",
        phase: "pre-commit",
        reason: "stage-write-failed",
        cleanupStatus: "cleanup-complete",
      },
    ],
    [
      "failure uppercase cleanup status",
      {
        result: "failed",
        phase: "pre-commit",
        reason: "stage-write-failed",
        cleanupStatus: "Verified-Complete",
      },
    ],
    [
      "failure cleanup status control",
      {
        result: "failed",
        phase: "pre-commit",
        reason: "stage-write-failed",
        cleanupStatus: "verified-complete\n",
      },
    ],
    [
      "failure cleanup status surrogate",
      {
        result: "failed",
        phase: "pre-commit",
        reason: "stage-write-failed",
        cleanupStatus: "not-verified\ud800",
      },
    ],
    [
      "failure non-string cleanup status",
      {
        result: "failed",
        phase: "pre-commit",
        reason: "stage-write-failed",
        cleanupStatus: null,
      },
    ],
    [
      "recovery missing digest",
      {
        result: "created-recovery-required",
        phase: "post-commit",
        finalProjectLocation: `/destination/parent/${modId}`,
        reason: "post-commit-journal-failed",
      },
    ],
    [
      "recovery wrong phase",
      {
        result: "created-recovery-required",
        phase: "pre-commit",
        planDigest: approvedPlanDigest,
        finalProjectLocation: `/destination/parent/${modId}`,
        reason: "post-commit-journal-failed",
      },
    ],
    [
      "recovery wrong digest",
      {
        result: "created-recovery-required",
        phase: "post-commit",
        planDigest: "f".repeat(64),
        finalProjectLocation: `/destination/parent/${modId}`,
        reason: "post-commit-journal-failed",
      },
    ],
    [
      "recovery wrong path",
      {
        result: "created-recovery-required",
        phase: "post-commit",
        planDigest: approvedPlanDigest,
        finalProjectLocation: "/destination/parent/Other",
        reason: "post-commit-journal-failed",
      },
    ],
    [
      "recovery pre-commit-only reason",
      {
        result: "created-recovery-required",
        phase: "post-commit",
        planDigest: approvedPlanDigest,
        finalProjectLocation: `/destination/parent/${modId}`,
        reason: "stage-write-failed",
      },
    ],
    [
      "recovery extra cleanup status",
      {
        result: "created-recovery-required",
        phase: "post-commit",
        planDigest: approvedPlanDigest,
        finalProjectLocation: `/destination/parent/${modId}`,
        reason: "post-commit-journal-failed",
        cleanupStatus: "not-verified",
      },
    ],
    [
      "reason control",
      {
        result: "failed",
        phase: "pre-commit",
        reason: "stage-write-failed\n",
        cleanupStatus: "verified-complete",
      },
    ],
    [
      "reason surrogate",
      {
        result: "failed",
        phase: "pre-commit",
        reason: "stage-write-failed\ud800",
        cleanupStatus: "verified-complete",
      },
    ],
    [
      "reason oversized",
      {
        result: "failed",
        phase: "pre-commit",
        reason: "x".repeat(1_049_000),
        cleanupStatus: "verified-complete",
      },
    ],
  ])("rejects malformed Apply result: %s", async (_label, response) => {
    invokeMock.mockResolvedValueOnce(response);
    await expectProtocolRejection(
      new TauriXcom2ProjectFoundryRendererAdapter().apply(applyRequest()),
      XCOM2_PROJECT_FOUNDRY_APPLY_COMMAND,
      "response",
    );
  });

  it("sanitizes an invalid cleanup status without exposing the provider value", async () => {
    invokeMock.mockResolvedValueOnce({
      result: "failed",
      phase: "pre-commit",
      reason: "stage-write-failed",
      cleanupStatus: "SECRET-CLEANUP:/private/provider",
    });

    const error = await expectProtocolRejection(
      new TauriXcom2ProjectFoundryRendererAdapter().apply(applyRequest()),
      XCOM2_PROJECT_FOUNDRY_APPLY_COMMAND,
      "response",
    );
    const exposed = `${error.message}\n${JSON.stringify(error)}\n${Reflect.ownKeys(error)
      .map((key) => String(Reflect.get(error, key)))
      .join("\n")}`;
    expect(exposed).not.toContain("SECRET-CLEANUP");
    expect(exposed).not.toContain("/private/provider");
    expect(error.cause).toBeUndefined();
  });

  it("rejects response accessors and proxies without executing or leaking provider data", async () => {
    const getter = vi.fn(() => "SECRET-ACCESSOR:/private/provider");
    const accessor = createdReceipt();
    Object.defineProperty(accessor, "finalProjectLocation", { enumerable: true, get: getter });
    const cleanupGetter = vi.fn(() => "SECRET-CLEANUP:/private/provider");
    const cleanupAccessor = {
      result: "failed",
      phase: "pre-commit",
      reason: "stage-write-failed",
    };
    Object.defineProperty(cleanupAccessor, "cleanupStatus", {
      enumerable: true,
      get: cleanupGetter,
    });
    const hidden = hiddenExtra(createdReceipt(), "providerPath");
    const symbol = createdReceipt();
    Object.defineProperty(symbol, Symbol("provider-secret"), { value: "SECRET" });
    const secret = new Error("SECRET-PROXY:/private/provider");
    const proxy = new Proxy(createdReceipt(), {
      getPrototypeOf: () => {
        throw secret;
      },
    });

    for (const response of [accessor, cleanupAccessor, hidden, symbol, proxy]) {
      invokeMock.mockResolvedValueOnce(response);
      const error = await expectProtocolRejection(
        new TauriXcom2ProjectFoundryRendererAdapter().apply(applyRequest()),
        XCOM2_PROJECT_FOUNDRY_APPLY_COMMAND,
        "response",
      );
      expect(error.message).not.toContain("SECRET");
      expect(error.message).not.toContain("/private/provider");
      expect(error.cause).toBeUndefined();
    }
    expect(getter).not.toHaveBeenCalled();
    expect(cleanupGetter).not.toHaveBeenCalled();
  });
});

describe("Project Foundry Apply sanitized invoke rejection", () => {
  it.each([
    ["raw path string", "/private/provider/SECRET-PATH"],
    ["raw Error", new Error("SECRET-ERROR:/private/provider/SECRET-PATH")],
    ["provider object", { message: "SECRET", path: "/private/provider/SECRET-PATH" }],
    ["symbol", Symbol("SECRET")],
  ])("sanitizes rejected Apply invocation from %s", async (_label, failure) => {
    invokeMock.mockRejectedValueOnce(failure);

    const error = await captureRejection(
      new TauriXcom2ProjectFoundryRendererAdapter().apply(applyRequest()),
    );

    expect(error).toMatchObject({
      name: "TauriAdapterError",
      command: XCOM2_PROJECT_FOUNDRY_APPLY_COMMAND,
      message: `[tauri:${XCOM2_PROJECT_FOUNDRY_APPLY_COMMAND}] Native Project Foundry command failed`,
      cause: undefined,
    });
    expect(error).not.toBe(failure);
    const exposed = `${error.message}\n${JSON.stringify(error)}\n${Reflect.ownKeys(error)
      .map((key) => String(Reflect.get(error, key)))
      .join("\n")}`;
    expect(exposed).not.toContain("SECRET");
    expect(exposed).not.toContain("/private/provider");
    expect(exposed).not.toContain("[object Object]");
  });

  it("fails closed when reading an invoking Error message throws", async () => {
    const secret = new Error("SECRET-CAUSE:/private/provider");
    const hostile = new Error("placeholder");
    Object.defineProperty(hostile, "message", {
      get: () => {
        throw secret;
      },
    });
    invokeMock.mockRejectedValueOnce(hostile);

    const error = await captureRejection(
      new TauriXcom2ProjectFoundryRendererAdapter().apply(applyRequest()),
    );

    expect(error.message).toBe(
      `[tauri:${XCOM2_PROJECT_FOUNDRY_APPLY_COMMAND}] Native Project Foundry command failed`,
    );
    expect(error.cause).toBeUndefined();
    expect(error.message).not.toContain("SECRET");
  });
});

describe("Project Foundry Apply corrected factory and composition", () => {
  it("exposes Apply on both corrected factory aliases and preserves every frozen facet", async () => {
    const composition = createTauriXcom2ProjectFoundryRendererComposition();
    const alias = createTauriProjectFoundryRendererComposition();

    expect(composition).toBeInstanceOf(TauriXcom2ProjectFoundryRendererAdapter);
    expect(alias).toBeInstanceOf(TauriProjectFoundryRendererAdapter);
    expect(Reflect.ownKeys(composition)).toEqual(["bridge", "selectors", "renderer", "grants"]);
    expect(typeof composition.apply).toBe("function");
    expect(typeof alias.apply).toBe("function");
    for (const facet of [composition.selectors, composition.renderer, composition.grants]) {
      expect(Object.isFrozen(facet)).toBe(true);
    }

    invokeMock.mockResolvedValueOnce(createdReceipt()).mockResolvedValueOnce(createdReceipt());
    await expect(composition.apply(applyRequest())).resolves.toEqual(createdReceipt());
    await expect(alias.apply(applyRequest())).resolves.toEqual(createdReceipt());
    expect(invokeMock.mock.calls).toEqual([
      [XCOM2_PROJECT_FOUNDRY_APPLY_COMMAND, { request: applyRequest() }],
      [XCOM2_PROJECT_FOUNDRY_APPLY_COMMAND, { request: applyRequest() }],
    ]);
  });
});
