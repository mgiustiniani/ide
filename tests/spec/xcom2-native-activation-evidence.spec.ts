import { describe, expect, expectTypeOf, it } from "vitest";

import {
  XCOM2_MODULE_SCAN_LIMITS,
  type Xcom2ModuleScanSnapshot,
} from "../../packages/contracts/src/domain/xcom2-module-activation";
import type { Xcom2ModuleConfigurationReadResult } from "../../packages/contracts/src/domain/xcom2-module-configuration-activation";
import {
  XCOM2_NATIVE_ACTIVATION_EVIDENCE_LIMITS,
  type Xcom2NativeAcceptedActivationSnapshot,
  type Xcom2NativeActivationAcknowledgment,
  type Xcom2NativeActivationCandidate,
  type Xcom2NativeActivationCurrent,
  type Xcom2NativeActivationEvidenceState,
  type Xcom2NativeActivationLifecycleEvent,
  type Xcom2NativeInspectionCurrent,
} from "../../packages/contracts/src/domain/xcom2-native-activation-evidence";
import {
  acknowledgeXcom2NativeActivationEvidence,
  authorizeXcom2NativeBuildRecipeInspection,
  beginXcom2NativeActivationEvidence,
  transitionXcom2NativeActivationEvidence,
} from "../../packages/contracts/src/domain/xcom2-native-activation-evidence-policy";
import { evaluateXcom2ModuleActivation } from "../../packages/web-core/src/xcom2/module-activation";
import { evaluateXcom2ProjectActivation } from "../../packages/web-core/src/xcom2/module-configuration-activation";

const correlation = Object.freeze({
  workspaceId: "workspace:authorized",
  workspaceGeneration: 7,
  activationGeneration: 11,
  activationAttemptReceipt: "opaque-attempt-receipt:11",
});

type Mutable<T> = {
  -readonly [Key in keyof T]: T[Key] extends readonly (infer Item)[]
    ? Mutable<Item>[]
    : T[Key] extends object
      ? Mutable<T[Key]>
      : T[Key];
};

function candidate(): Mutable<Xcom2NativeActivationCandidate> {
  return {
    scan: {
      ...correlation,
      scanId: "xcom2-module-scan:11",
      scanGeneration: 5,
      completeness: "complete",
      issues: [],
      limits: XCOM2_MODULE_SCAN_LIMITS,
      observations: [
        {
          evidenceKind: "xcommod",
          moduleRoot: "mods/recognized",
          relativePath: "mods/recognized/Recognized.XComMod",
        },
        {
          evidenceKind: "x2proj",
          moduleRoot: "mods/recognized",
          relativePath: "mods/recognized/Recognized.x2proj",
        },
        {
          evidenceKind: "x2proj",
          moduleRoot: "mods/weak",
          relativePath: "mods/weak/Weak.x2proj",
        },
      ],
      evidenceHandles: [
        {
          moduleRoot: "mods/weak",
          evidenceHandle: "opaque-evidence-handle:weak",
        },
        {
          moduleRoot: "mods/recognized",
          evidenceHandle: "opaque-evidence-handle:recognized",
        },
      ],
    },
    configuration: {
      ...correlation,
      configurationReadId: "xcom2-configuration-read:11",
      kind: "ready",
      configuration: {
        version: 1,
        target: "wotc",
        moduleRoots: ["mods/configured"],
      },
      evidenceHandles: [
        {
          moduleRoot: "mods/configured",
          evidenceHandle: "opaque-evidence-handle:configured",
        },
      ],
    },
  };
}

function evaluate(input: Xcom2NativeActivationCandidate = candidate()) {
  const scan: Xcom2ModuleScanSnapshot = {
    workspaceId: input.scan.workspaceId,
    workspaceGeneration: input.scan.workspaceGeneration,
    scanId: input.scan.scanId,
    scanGeneration: input.scan.scanGeneration,
    completeness: input.scan.completeness,
    issues: input.scan.issues,
    limits: input.scan.limits,
    observations: input.scan.observations,
  };
  const configuration = {
    workspaceId: input.configuration.workspaceId,
    workspaceGeneration: input.configuration.workspaceGeneration,
    activationGeneration: input.configuration.activationGeneration,
    configurationReadId: input.configuration.configurationReadId,
    kind: input.configuration.kind,
    ...(input.configuration.kind === "ready"
      ? { configuration: input.configuration.configuration }
      : input.configuration.kind === "stopped"
        ? { code: input.configuration.code }
        : {}),
  } as Xcom2ModuleConfigurationReadResult;
  const request = {
    workspaceId: input.configuration.workspaceId,
    workspaceGeneration: input.configuration.workspaceGeneration,
    activationGeneration: input.configuration.activationGeneration,
    configurationReadId: input.configuration.configurationReadId,
  };

  return evaluateXcom2ProjectActivation(
    request,
    configuration,
    evaluateXcom2ModuleActivation(scan),
  );
}

function pending(input: Xcom2NativeActivationCandidate = candidate()) {
  const result = beginXcom2NativeActivationEvidence(input);
  expect(result.kind).toBe("pending");
  if (result.kind !== "pending") throw new Error(`Expected pending, received ${result.code}`);
  return result.state;
}

function current(
  overrides: Partial<Xcom2NativeActivationCurrent> = {},
): Xcom2NativeActivationCurrent {
  return { ...correlation, ...overrides };
}

function acknowledged(input: Xcom2NativeActivationCandidate = candidate()) {
  const result = acknowledgeXcom2NativeActivationEvidence(
    pending(input),
    evaluate(input),
    current(),
  );
  expect(result.kind).toBe("acknowledged");
  if (result.kind !== "acknowledged") {
    throw new Error(`Expected acknowledged, received ${result.code}`);
  }
  return result;
}

function acceptedSnapshot(
  state: Extract<Xcom2NativeActivationEvidenceState, { kind: "acknowledged" }>,
): Xcom2NativeAcceptedActivationSnapshot {
  return {
    workspaceId: state.workspaceId,
    workspaceGeneration: state.workspaceGeneration,
    activationGeneration: state.activationGeneration,
    activationAttemptReceipt: state.activationAttemptReceipt,
    modules: state.selectedModules.map(({ moduleRoot, evidenceHandle }) => ({
      moduleRoot,
      evidenceHandle,
    })),
  };
}

describe("@REQ-XCOM2-PROJECT-BUILD-RECIPE-001 opaque native activation-evidence acknowledgment", () => {
  it("begins one immutable pending attempt while retaining native facts for the trusted evaluators", () => {
    const input = candidate();
    const before = structuredClone(input);
    const result = beginXcom2NativeActivationEvidence(input);

    expect(result).toMatchObject({
      kind: "pending",
      state: {
        kind: "pending",
        ...correlation,
        scan: {
          scanId: "xcom2-module-scan:11",
          observations: before.scan.observations,
        },
        configuration: {
          configurationReadId: "xcom2-configuration-read:11",
          configuration:
            before.configuration.kind === "ready" ? before.configuration.configuration : undefined,
        },
      },
    });
    expect(input).toEqual(before);

    input.scan.observations[0]!.moduleRoot = "mutated";
    if (input.configuration.kind === "ready")
      input.configuration.configuration.moduleRoots[0] = "mutated";
    expect(result.kind === "pending" && result.state.scan.observations[0]?.moduleRoot).toBe(
      "mods/recognized",
    );
    expect(
      result.kind === "pending" &&
        result.state.configuration.kind === "ready" &&
        result.state.configuration.configuration.moduleRoots[0],
    ).toBe("mods/configured");
    expect(result.kind === "pending" && Object.isFrozen(result.state)).toBe(true);
    expect(result.kind === "pending" && Object.isFrozen(result.state.scan.observations[0])).toBe(
      true,
    );
  });

  it("acknowledges only opaque selected handles for evaluated active roots in deterministic root order", () => {
    const result = acknowledged();

    expect(result.acknowledgment).toEqual({
      activationAttemptReceipt: "opaque-attempt-receipt:11",
      evidenceHandles: ["opaque-evidence-handle:configured", "opaque-evidence-handle:recognized"],
    });
    expect(Object.keys(result.acknowledgment).sort()).toEqual([
      "activationAttemptReceipt",
      "evidenceHandles",
    ]);
    expect(JSON.stringify(result.acknowledgment)).not.toMatch(
      /workspace|moduleRoot|mods\/|relativePath|configuration|content|bytes|hash|digest|path/iu,
    );
    expect(result.state.selectedModules).toEqual([
      {
        moduleRoot: "mods/configured",
        evidenceHandle: "opaque-evidence-handle:configured",
      },
      {
        moduleRoot: "mods/recognized",
        evidenceHandle: "opaque-evidence-handle:recognized",
      },
    ]);
    expect(result.state.selectedModules).not.toContainEqual(
      expect.objectContaining({ moduleRoot: "mods/weak" }),
    );
    expect(Object.isFrozen(result.acknowledgment)).toBe(true);
    expect(Object.isFrozen(result.acknowledgment.evidenceHandles)).toBe(true);
    expect(Object.isFrozen(result.state.selectedModules)).toBe(true);
  });

  it.each([
    ["inactive", []],
    [
      "needs-confirmation",
      [
        {
          evidenceKind: "x2proj" as const,
          moduleRoot: "mods/weak",
          relativePath: "mods/weak/Weak.x2proj",
        },
      ],
    ],
  ])("refuses an evaluated %s attempt", (code, observations) => {
    const input = candidate();
    input.scan.observations = observations;
    input.scan.evidenceHandles = observations.length
      ? [{ moduleRoot: "mods/weak", evidenceHandle: "opaque-evidence-handle:weak" }]
      : [];
    if (input.configuration.kind === "ready") {
      input.configuration.configuration.moduleRoots = [];
      input.configuration.evidenceHandles = [];
    }

    const result = acknowledgeXcom2NativeActivationEvidence(
      pending(input),
      evaluate(input),
      current(),
    );

    expect(result).toMatchObject({ kind: "refused", code });
  });

  it("refuses incomplete evidence even when the current evaluator has an active decision", () => {
    const input = candidate();
    input.scan.completeness = "partial";
    input.scan.issues = [{ kind: "unreadable-subtree", relativePath: "mods/hidden" }];

    const result = acknowledgeXcom2NativeActivationEvidence(
      pending(input),
      evaluate(input),
      current(),
    );

    expect(result).toMatchObject({ kind: "refused", code: "incomplete-evidence" });
  });

  it("refuses stale current generations and mixed native attempts", () => {
    const stale = acknowledgeXcom2NativeActivationEvidence(
      pending(),
      evaluate(),
      current({ workspaceGeneration: 8 }),
    );
    const mixed = candidate();
    mixed.configuration.activationAttemptReceipt = "opaque-attempt-receipt:other";

    expect(stale).toMatchObject({ kind: "refused", code: "stale-correlation" });
    expect(beginXcom2NativeActivationEvidence(mixed)).toMatchObject({
      kind: "refused",
      code: "mixed-activation-attempt",
      state: { kind: "revoked", code: "mixed-activation-attempt" },
    });
  });

  it("refuses duplicate or unknown retained evidence handles", () => {
    const duplicate = candidate();
    if (duplicate.configuration.kind === "ready") {
      duplicate.configuration.evidenceHandles[0]!.evidenceHandle =
        "opaque-evidence-handle:recognized";
    }
    const unknown = candidate();
    if (unknown.configuration.kind === "ready") unknown.configuration.evidenceHandles = [];

    expect(
      acknowledgeXcom2NativeActivationEvidence(pending(duplicate), evaluate(duplicate), current()),
    ).toMatchObject({ kind: "refused", code: "duplicate-evidence-handle" });
    expect(
      acknowledgeXcom2NativeActivationEvidence(pending(unknown), evaluate(unknown), current()),
    ).toMatchObject({ kind: "refused", code: "unknown-evidence-handle" });
  });

  it.each([
    "workspace-refresh",
    "workspace-switch-started",
    "workspace-activation-started",
    "workspace-activation-failed",
    "activation-attempt-failed",
    "app-exit",
    "cached-react-restoration",
  ] as const)("synchronously revokes acknowledged authority on %s", (kind) => {
    const state = acknowledged().state;
    const event = { kind } satisfies Xcom2NativeActivationLifecycleEvent;

    const result = transitionXcom2NativeActivationEvidence(state, event);

    expect(result).toEqual({
      kind: "revoked",
      state: { kind: "revoked", code: kind },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.state)).toBe(true);
  });

  it("revokes pending authority on a newer activation generation and never on an older notification", () => {
    const state = pending();

    expect(
      transitionXcom2NativeActivationEvidence(state, {
        kind: "newer-activation-generation",
        activationGeneration: 12,
      }),
    ).toEqual({
      kind: "revoked",
      state: { kind: "revoked", code: "newer-activation-generation" },
    });
    expect(
      transitionXcom2NativeActivationEvidence(state, {
        kind: "newer-activation-generation",
        activationGeneration: 11,
      }),
    ).toMatchObject({ kind: "retained", state: { kind: "pending" } });
  });

  it("authorizes inspection only when current identity and the native accepted snapshot match", () => {
    const state = acknowledged().state;
    const snapshot = acceptedSnapshot(state);
    const request = {
      workspaceId: correlation.workspaceId,
      generation: correlation.workspaceGeneration,
      moduleRoot: "mods/recognized",
    } satisfies Xcom2NativeInspectionCurrent;

    const result = authorizeXcom2NativeBuildRecipeInspection(state, request, snapshot);

    expect(result).toEqual({
      kind: "authorized",
      workspaceId: "workspace:authorized",
      generation: 7,
      activationGeneration: 11,
      moduleRoot: "mods/recognized",
    });
    expect(Object.keys(request).sort()).toEqual(["generation", "moduleRoot", "workspaceId"]);
    expectTypeOf(request).not.toHaveProperty("activationAttemptReceipt");
    expectTypeOf(request).not.toHaveProperty("evidenceHandle");
    expectTypeOf(result).not.toHaveProperty("activationAttemptReceipt");
    expectTypeOf(result).not.toHaveProperty("evidenceHandle");
  });

  it("refuses stale workspaces, inactive roots, revoked state, and altered native accepted snapshots", () => {
    const state = acknowledged().state;
    const snapshot = acceptedSnapshot(state);
    const baseRequest: Xcom2NativeInspectionCurrent = {
      workspaceId: correlation.workspaceId,
      generation: correlation.workspaceGeneration,
      moduleRoot: "mods/recognized",
    };

    expect(
      authorizeXcom2NativeBuildRecipeInspection(state, { ...baseRequest, generation: 8 }, snapshot),
    ).toEqual({ kind: "refused", code: "stale-workspace" });
    expect(
      authorizeXcom2NativeBuildRecipeInspection(
        state,
        { ...baseRequest, moduleRoot: "mods/weak" },
        snapshot,
      ),
    ).toEqual({ kind: "refused", code: "module-not-active" });
    expect(
      authorizeXcom2NativeBuildRecipeInspection(
        { kind: "revoked", code: "workspace-refresh" },
        baseRequest,
        snapshot,
      ),
    ).toEqual({ kind: "refused", code: "authority-unavailable" });
    expect(
      authorizeXcom2NativeBuildRecipeInspection(state, baseRequest, {
        ...snapshot,
        activationAttemptReceipt: "opaque-attempt-receipt:altered",
      }),
    ).toEqual({ kind: "refused", code: "accepted-snapshot-mismatch" });
  });

  it("uses exact-object validation and bounded opaque IDs and counts", () => {
    expect(
      beginXcom2NativeActivationEvidence({ ...candidate(), injectedAuthority: true } as never),
    ).toMatchObject({ kind: "refused", code: "candidate-invalid" });

    const oversizedReceipt = candidate();
    oversizedReceipt.scan.activationAttemptReceipt = "r".repeat(
      XCOM2_NATIVE_ACTIVATION_EVIDENCE_LIMITS.maximumOpaqueIdBytes + 1,
    );
    oversizedReceipt.configuration.activationAttemptReceipt =
      oversizedReceipt.scan.activationAttemptReceipt;
    expect(beginXcom2NativeActivationEvidence(oversizedReceipt)).toMatchObject({
      kind: "refused",
      code: "candidate-invalid",
    });

    const tooMany = candidate();
    tooMany.scan.evidenceHandles = Array.from(
      { length: XCOM2_NATIVE_ACTIVATION_EVIDENCE_LIMITS.maximumEvidenceHandles + 1 },
      (_, index) => ({
        moduleRoot: `mods/root-${index}`,
        evidenceHandle: `opaque-evidence-handle:${index}`,
      }),
    );
    expect(beginXcom2NativeActivationEvidence(tooMany)).toMatchObject({
      kind: "refused",
      code: "candidate-invalid",
    });

    const state = acknowledged().state;
    expect(
      authorizeXcom2NativeBuildRecipeInspection(
        state,
        {
          workspaceId: correlation.workspaceId,
          generation: 7,
          moduleRoot: "mods/recognized",
          token: "forged",
        } as never,
        acceptedSnapshot(state),
      ),
    ).toEqual({ kind: "refused", code: "request-invalid" });
  });

  it("publishes closed provider-neutral acknowledgment and authority contracts", () => {
    expect(XCOM2_NATIVE_ACTIVATION_EVIDENCE_LIMITS).toEqual({
      maximumOpaqueIdBytes: 256,
      maximumEvidenceHandles: 64,
    });
    expect(Object.isFrozen(XCOM2_NATIVE_ACTIVATION_EVIDENCE_LIMITS)).toBe(true);
    expectTypeOf<Xcom2NativeActivationAcknowledgment>().not.toHaveProperty("workspaceId");
    expectTypeOf<Xcom2NativeActivationAcknowledgment>().not.toHaveProperty("moduleRoot");
    expectTypeOf<Xcom2NativeActivationAcknowledgment>().not.toHaveProperty("path");
    expectTypeOf<Xcom2NativeActivationAcknowledgment>().not.toHaveProperty("configuration");
    expectTypeOf<Xcom2NativeActivationAcknowledgment>().not.toHaveProperty("hash");
    expectTypeOf<Xcom2NativeActivationCandidate>().not.toHaveProperty("provider");
    expectTypeOf<Xcom2NativeActivationCandidate>().not.toHaveProperty("command");
  });
});
