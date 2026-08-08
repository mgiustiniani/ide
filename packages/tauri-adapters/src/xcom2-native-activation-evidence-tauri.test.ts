import {
  XCOM2_MODULE_SCAN_LIMITS,
  type Xcom2NativeActivationAcknowledgment,
  type Xcom2NativeActivationCandidate,
} from "@ide/contracts";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TauriAdapterError } from "./errors";
import {
  TauriXcom2NativeActivationEvidenceAdapter,
  XCOM2_NATIVE_ACTIVATION_EVIDENCE_COMMANDS,
  createTauriXcom2NativeActivationEvidencePort,
} from "./xcom2-native-activation-evidence-tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);
const commands = {
  begin: "begin_xcom2_native_activation_evidence",
  acknowledge: "acknowledge_xcom2_native_activation_evidence",
  revoke: "revoke_xcom2_native_activation_evidence",
} as const;
const correlation = {
  workspaceId: "workspace:authorized",
  workspaceGeneration: 7,
  activationGeneration: 11,
  activationAttemptReceipt: "opaque-attempt-receipt:11",
} as const;
const handles = ["opaque-evidence-handle:alpha", "opaque-evidence-handle:beta"] as const;

function beginRequest() {
  return {
    workspaceId: correlation.workspaceId,
    workspaceGeneration: correlation.workspaceGeneration,
    scanId: "xcom2-module-scan:11",
    scanGeneration: 5,
    configurationReadId: "xcom2-configuration-read:11",
    limits: { ...XCOM2_MODULE_SCAN_LIMITS },
  } as const;
}

function candidate(): Xcom2NativeActivationCandidate {
  return {
    scan: {
      ...correlation,
      scanId: beginRequest().scanId,
      scanGeneration: beginRequest().scanGeneration,
      completeness: "complete",
      issues: [],
      limits: { ...XCOM2_MODULE_SCAN_LIMITS },
      observations: [
        {
          evidenceKind: "x2proj",
          moduleRoot: "mods/alpha",
          relativePath: "mods/alpha/Alpha.x2proj",
        },
        {
          evidenceKind: "x2proj",
          moduleRoot: "mods/beta",
          relativePath: "mods/beta/Beta.x2proj",
        },
      ],
      evidenceHandles: [
        { moduleRoot: "mods/alpha", evidenceHandle: handles[0] },
        { moduleRoot: "mods/beta", evidenceHandle: handles[1] },
      ],
    },
    configuration: {
      ...correlation,
      configurationReadId: beginRequest().configurationReadId,
      kind: "ready",
      configuration: { version: 1, target: "wotc", moduleRoots: ["mods/alpha", "mods/beta"] },
      evidenceHandles: [
        { moduleRoot: "mods/alpha", evidenceHandle: handles[0] },
        { moduleRoot: "mods/beta", evidenceHandle: handles[1] },
      ],
    },
  };
}

function acknowledgment(): Xcom2NativeActivationAcknowledgment {
  return {
    activationAttemptReceipt: correlation.activationAttemptReceipt,
    evidenceHandles: [...handles],
  };
}

function acknowledgedState() {
  return {
    kind: "acknowledged",
    ...correlation,
    acknowledgment: acknowledgment(),
    selectedModules: [
      { moduleRoot: "mods/alpha", evidenceHandle: handles[0] },
      { moduleRoot: "mods/beta", evidenceHandle: handles[1] },
    ],
  } as const;
}

function pendingState() {
  const value = candidate();
  return {
    kind: "pending",
    ...correlation,
    scan: value.scan,
    configuration: value.configuration,
  } as const;
}

async function expectResponseRejection(
  operation: () => Promise<unknown>,
  command: string,
): Promise<TauriAdapterError> {
  try {
    await operation();
    throw new Error("expected native response rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(TauriAdapterError);
    expect(error).toMatchObject({ name: "TauriAdapterError", command, cause: undefined });
    expect((error as Error).message).toContain("Invalid native XCOM 2 response:");
    return error as TauriAdapterError;
  }
}

function mutableCandidate(): any {
  return structuredClone(candidate());
}

function accessorRecord(value: Record<string, unknown>, field: string, getter: () => unknown) {
  const result = { ...value };
  Object.defineProperty(result, field, { enumerable: true, get: getter });
  return result;
}

describe("REQ-XCOM2 Tauri native activation command custody", () => {
  beforeEach(() => invokeMock.mockReset());

  it("exports exactly the three activation commands and sends frozen exact begin/acknowledge/revoke envelopes", async () => {
    expect(XCOM2_NATIVE_ACTIVATION_EVIDENCE_COMMANDS).toEqual(commands);
    expect(Object.isFrozen(XCOM2_NATIVE_ACTIVATION_EVIDENCE_COMMANDS)).toBe(true);
    invokeMock
      .mockImplementationOnce((_command, args) => {
        const envelope = args as { request: ReturnType<typeof beginRequest> };
        expect(Reflect.ownKeys(envelope)).toEqual(["request"]);
        expect(Object.isFrozen(envelope)).toBe(true);
        expect(Object.isFrozen(envelope.request)).toBe(true);
        expect(Object.isFrozen(envelope.request.limits)).toBe(true);
        return Promise.resolve(candidate());
      })
      .mockImplementationOnce((_command, args) => {
        const envelope = args as { acknowledgment: Xcom2NativeActivationAcknowledgment };
        expect(Reflect.ownKeys(envelope)).toEqual(["acknowledgment"]);
        expect(Object.isFrozen(envelope)).toBe(true);
        expect(Object.isFrozen(envelope.acknowledgment)).toBe(true);
        expect(Object.isFrozen(envelope.acknowledgment.evidenceHandles)).toBe(true);
        return Promise.resolve({
          kind: "acknowledged",
          acknowledgment: acknowledgment(),
          state: acknowledgedState(),
        });
      })
      .mockImplementationOnce((_command, args) => {
        const envelope = args as { event: { kind: string } };
        expect(Reflect.ownKeys(envelope)).toEqual(["event"]);
        expect(Object.isFrozen(envelope)).toBe(true);
        expect(Object.isFrozen(envelope.event)).toBe(true);
        return Promise.resolve({
          kind: "revoked",
          state: { kind: "revoked", code: "workspace-refresh" },
        });
      });

    const adapter = new TauriXcom2NativeActivationEvidenceAdapter();
    await adapter.begin(beginRequest());
    await adapter.acknowledge(acknowledgment());
    await adapter.revoke({ kind: "workspace-refresh" });

    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
      commands.begin,
      commands.acknowledge,
      commands.revoke,
    ]);
    expect(invokeMock.mock.calls[0]).toEqual([commands.begin, { request: beginRequest() }]);
    expect(invokeMock.mock.calls[1]).toEqual([
      commands.acknowledge,
      { acknowledgment: acknowledgment() },
    ]);
    expect(invokeMock.mock.calls[2]).toEqual([
      commands.revoke,
      { event: { kind: "workspace-refresh" } },
    ]);
  });

  it("sends acknowledgment custody as only receipt plus handles and never roots or paths", async () => {
    invokeMock.mockResolvedValueOnce({
      kind: "acknowledged",
      acknowledgment: acknowledgment(),
      state: acknowledgedState(),
    });

    await new TauriXcom2NativeActivationEvidenceAdapter().acknowledge(acknowledgment());

    const envelope = invokeMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(Reflect.ownKeys((envelope.acknowledgment as object) ?? {})).toEqual([
      "activationAttemptReceipt",
      "evidenceHandles",
    ]);
    const serialized = JSON.stringify(envelope);
    expect(serialized).not.toMatch(/(?:root|path|workspaceId|generation)/iu);
    expect(serialized).toContain(correlation.activationAttemptReceipt);
    expect(serialized).toContain(handles[0]);
  });

  it("detaches and freezes an exact begin response", async () => {
    const source = candidate();
    invokeMock.mockResolvedValueOnce(source);

    const result = await new TauriXcom2NativeActivationEvidenceAdapter().begin(beginRequest());

    expect(result).toEqual(source);
    expect(result).not.toBe(source);
    expect(result.scan).not.toBe(source.scan);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.scan)).toBe(true);
    expect(Object.isFrozen(result.scan.observations)).toBe(true);
    expect(Object.isFrozen(result.configuration)).toBe(true);
  });

  it("normalizes exact acknowledged and refused acknowledgment decisions", async () => {
    invokeMock
      .mockResolvedValueOnce({
        kind: "acknowledged",
        acknowledgment: acknowledgment(),
        state: acknowledgedState(),
      })
      .mockResolvedValueOnce({
        kind: "refused",
        code: "stale-correlation",
        state: { kind: "revoked", code: "workspace-refresh" },
      });
    const adapter = new TauriXcom2NativeActivationEvidenceAdapter();

    const accepted = await adapter.acknowledge(acknowledgment());
    const refused = await adapter.acknowledge(acknowledgment());

    expect(accepted).toEqual({
      kind: "acknowledged",
      acknowledgment: acknowledgment(),
      state: acknowledgedState(),
    });
    expect(refused).toEqual({
      kind: "refused",
      code: "stale-correlation",
      state: { kind: "revoked", code: "workspace-refresh" },
    });
    expect(Object.isFrozen(accepted)).toBe(true);
    expect(Object.isFrozen(accepted.state)).toBe(true);
    expect(Object.isFrozen(refused)).toBe(true);
    expect(Object.isFrozen(refused.state)).toBe(true);
  });

  it("normalizes exact revoked and retained lifecycle decisions", async () => {
    invokeMock
      .mockResolvedValueOnce({
        kind: "revoked",
        state: { kind: "revoked", code: "app-exit" },
      })
      .mockResolvedValueOnce({ kind: "retained", state: pendingState() });
    const adapter = new TauriXcom2NativeActivationEvidenceAdapter();

    const revoked = await adapter.revoke({ kind: "app-exit" });
    const retained = await adapter.revoke({
      kind: "newer-activation-generation",
      activationGeneration: 10,
    });

    expect(revoked).toEqual({
      kind: "revoked",
      state: { kind: "revoked", code: "app-exit" },
    });
    expect(retained).toEqual({ kind: "retained", state: pendingState() });
    expect(Object.isFrozen(revoked)).toBe(true);
    expect(Object.isFrozen(retained)).toBe(true);
    expect(Object.isFrozen(retained.state)).toBe(true);
  });
});

describe("REQ-XCOM2 Tauri native activation fail-closed parsing", () => {
  beforeEach(() => invokeMock.mockReset());

  it.each([
    [
      "workspace",
      (value: any) => {
        value.scan.workspaceId = "workspace:stale";
        value.configuration.workspaceId = "workspace:stale";
      },
    ],
    [
      "workspace generation",
      (value: any) => {
        value.scan.workspaceGeneration = 8;
        value.configuration.workspaceGeneration = 8;
      },
    ],
    ["scan ID", (value: any) => (value.scan.scanId = "scan:stale")],
    ["scan generation", (value: any) => (value.scan.scanGeneration = 6)],
    [
      "configuration read ID",
      (value: any) => (value.configuration.configurationReadId = "read:stale"),
    ],
  ])("rejects stale begin %s correlation", async (_label, mutate) => {
    const response = mutableCandidate();
    mutate(response);
    invokeMock.mockResolvedValueOnce(response);

    const error = await expectResponseRejection(
      () => new TauriXcom2NativeActivationEvidenceAdapter().begin(beginRequest()),
      commands.begin,
    );

    expect(error.message).toContain("correlation is stale");
  });

  it.each([
    [
      "duplicate scan root/handle entry",
      (value: any) => value.scan.evidenceHandles.splice(1, 1, { ...value.scan.evidenceHandles[0] }),
    ],
    [
      "one handle cross-bound to two roots",
      (value: any) => (value.scan.evidenceHandles[1].evidenceHandle = handles[0]),
    ],
    [
      "one root cross-bound to different handles",
      (value: any) => (value.configuration.evidenceHandles[0].evidenceHandle = "other-handle"),
    ],
    ["noncanonical scan handle order", (value: any) => value.scan.evidenceHandles.reverse()],
    [
      "noncanonical configuration roots",
      (value: any) => value.configuration.configuration.moduleRoots.reverse(),
    ],
    [
      "noncanonical configuration handle order",
      (value: any) => value.configuration.evidenceHandles.reverse(),
    ],
    ["absolute root", (value: any) => (value.scan.evidenceHandles[0].moduleRoot = "/mods/alpha")],
    [
      "escaping root",
      (value: any) => (value.configuration.configuration.moduleRoots[0] = "mods/../alpha"),
    ],
  ])("rejects %s", async (_label, mutate) => {
    const response = mutableCandidate();
    mutate(response);
    invokeMock.mockResolvedValueOnce(response);

    await expectResponseRejection(
      () => new TauriXcom2NativeActivationEvidenceAdapter().begin(beginRequest()),
      commands.begin,
    );
  });

  it.each([
    ["extra begin response field", () => ({ ...candidate(), nativeRoot: "/private/secret" })],
    ["missing begin response field", () => ({ scan: candidate().scan })],
    [
      "extra nested scan field",
      () => ({ ...candidate(), scan: { ...candidate().scan, path: "/private/secret" } }),
    ],
    [
      "extra acknowledged decision field",
      () => ({
        kind: "acknowledged",
        acknowledgment: acknowledgment(),
        state: acknowledgedState(),
        root: "/private/secret",
      }),
    ],
  ])("rejects exact-object violation: %s", async (_label, response) => {
    invokeMock.mockResolvedValueOnce(response());
    const operation = _label.includes("acknowledged")
      ? () => new TauriXcom2NativeActivationEvidenceAdapter().acknowledge(acknowledgment())
      : () => new TauriXcom2NativeActivationEvidenceAdapter().begin(beginRequest());

    await expectResponseRejection(
      operation,
      _label.includes("acknowledged") ? commands.acknowledge : commands.begin,
    );
  });

  it("rejects stale acknowledged bindings and duplicate acknowledgment handles", async () => {
    invokeMock
      .mockResolvedValueOnce({
        kind: "acknowledged",
        acknowledgment: { ...acknowledgment(), activationAttemptReceipt: "stale-receipt" },
        state: acknowledgedState(),
      })
      .mockResolvedValueOnce({
        kind: "acknowledged",
        acknowledgment: acknowledgment(),
        state: {
          ...acknowledgedState(),
          acknowledgment: {
            activationAttemptReceipt: correlation.activationAttemptReceipt,
            evidenceHandles: [handles[0], handles[0]],
          },
        },
      });
    const adapter = new TauriXcom2NativeActivationEvidenceAdapter();

    await expectResponseRejection(
      () => adapter.acknowledge(acknowledgment()),
      commands.acknowledge,
    );
    await expectResponseRejection(
      () => adapter.acknowledge(acknowledgment()),
      commands.acknowledge,
    );
  });

  it("rejects hostile response proxies and accessors without executing a getter", async () => {
    const getter = vi.fn(() => candidate().scan);
    const accessor = accessorRecord(
      candidate() as unknown as Record<string, unknown>,
      "scan",
      getter,
    );
    const proxy = new Proxy(candidate(), {
      ownKeys() {
        throw new Error("HOSTILE-PROXY:/private/secret");
      },
    });
    invokeMock.mockResolvedValueOnce(accessor).mockResolvedValueOnce(proxy);
    const adapter = new TauriXcom2NativeActivationEvidenceAdapter();

    await expectResponseRejection(() => adapter.begin(beginRequest()), commands.begin);
    await expectResponseRejection(() => adapter.begin(beginRequest()), commands.begin);
    expect(getter).not.toHaveBeenCalled();
  });

  it("rejects hostile request proxies and accessors before invoke without executing a getter", async () => {
    const getter = vi.fn(() => correlation.workspaceId);
    const accessor = accessorRecord(
      beginRequest() as unknown as Record<string, unknown>,
      "workspaceId",
      getter,
    );
    const proxy = new Proxy(beginRequest(), {
      getOwnPropertyDescriptor() {
        throw new Error("HOSTILE-REQUEST:/private/secret");
      },
    });
    const adapter = new TauriXcom2NativeActivationEvidenceAdapter();

    await expect(
      adapter.begin(accessor as unknown as ReturnType<typeof beginRequest>),
    ).rejects.toMatchObject({ name: "TauriAdapterError", command: commands.begin });
    await expect(adapter.begin(proxy)).rejects.toMatchObject({
      name: "TauriAdapterError",
      command: commands.begin,
    });
    expect(getter).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it.each([
    ["begin", () => new TauriXcom2NativeActivationEvidenceAdapter().begin(beginRequest())],
    [
      "acknowledge",
      () => new TauriXcom2NativeActivationEvidenceAdapter().acknowledge(acknowledgment()),
    ],
    ["revoke", () => new TauriXcom2NativeActivationEvidenceAdapter().revoke({ kind: "app-exit" })],
  ])("redacts hostile %s transport errors", async (name, operation) => {
    const secret = `NATIVE-${name}-SECRET:/private/workspace`;
    invokeMock.mockRejectedValueOnce({ message: secret, cause: new Error(secret) });

    let rejected: unknown;
    try {
      await operation();
    } catch (error) {
      rejected = error;
    }

    expect(rejected).toMatchObject({
      name: "TauriAdapterError",
      command: commands[name as keyof typeof commands],
      message: `[tauri:${commands[name as keyof typeof commands]}] Native XCOM 2 command failed`,
      cause: undefined,
    });
    expect(JSON.stringify(rejected)).not.toContain(secret);
  });

  it("exports a fresh correctly typed activation adapter factory instance", () => {
    const first = createTauriXcom2NativeActivationEvidencePort();
    const second = createTauriXcom2NativeActivationEvidencePort();

    expect(first).toBeInstanceOf(TauriXcom2NativeActivationEvidenceAdapter);
    expect(second).toBeInstanceOf(TauriXcom2NativeActivationEvidenceAdapter);
    expect(second).not.toBe(first);
  });
});
