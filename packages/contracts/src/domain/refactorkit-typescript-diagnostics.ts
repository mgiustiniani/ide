import type {
  RefactorKitCapabilities,
  RefactorKitLanguageAdapterRuntime,
  RefactorKitLanguageCapabilityEvidence,
} from "../refactorkit";

/** The semantic toolchain evidence that was qualified for one live language session. */
export interface TypeScriptDiagnosticsToolchainEvidence {
  evidence: RefactorKitLanguageCapabilityEvidence;
  backend: string;
  runtime: RefactorKitLanguageAdapterRuntime;
  extensions: string[];
}

export type TypeScriptDiagnosticsSemanticSession =
  | {
      state: "unavailable";
      reason: string;
    }
  | {
      state: "ready";
      qualification: "qualified" | "unqualified";
      languageId: string;
      workspaceId: string;
      workspaceGeneration: number;
      sessionId: string;
      snapshotHash: string | null;
      providerVersion: string;
      toolchain: TypeScriptDiagnosticsToolchainEvidence;
    };

/** All current authority and discovery evidence needed before crossing an invocation port. */
export interface TypeScriptDiagnosticsPolicyInput {
  languageId: string;
  sourceExtension: string;
  workspaceId: string;
  workspaceGeneration: number;
  authorizedWorkspaceId: string;
  authorizedWorkspaceGeneration: number;
  snapshotHash: string;
  capabilities: RefactorKitCapabilities;
  semanticSession: TypeScriptDiagnosticsSemanticSession;
}

/** Provider-neutral request passed to a diagnostics invocation boundary after readiness succeeds. */
export interface TypeScriptDiagnosticsRequest {
  readonly languageId: "typescript";
  readonly workspaceId: string;
  readonly workspaceGeneration: number;
  readonly sessionId: string;
  readonly snapshotHash: string;
  readonly providerVersion: string;
  readonly backend: string;
}

export type TypeScriptDiagnosticsRefusalReason =
  | "invalid-language-id"
  | "invalid-workspace-id"
  | "workspace-generation-nonpositive"
  | "workspace-generation-stale"
  | "workspace-unauthorized"
  | "snapshot-identity-absent"
  | "capability-absent"
  | "capability-ambiguous"
  | "capability-proposal-inappropriate"
  | "capability-mutation-authority-inappropriate"
  | "capability-stability-inappropriate"
  | "capability-evidence-unqualified"
  | "capability-backend-unauthorized"
  | "capability-runtime-unauthorized"
  | "capability-extensions-unauthorized"
  | "semantic-toolchain-unavailable"
  | "semantic-toolchain-unqualified"
  | "invalid-session-id"
  | "semantic-session-authority-mismatch"
  | "semantic-session-hash-unbound"
  | "semantic-session-snapshot-mismatch"
  | "provider-version-unavailable"
  | "provider-version-mismatch"
  | "semantic-toolchain-mismatch";

export type TypeScriptDiagnosticsDecision =
  | { readonly kind: "ready"; readonly request: Readonly<TypeScriptDiagnosticsRequest> }
  | { readonly kind: "refused"; readonly reason: TypeScriptDiagnosticsRefusalReason };

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;
const SOURCE_EXTENSION = /^[a-z0-9]+$/u;

/**
 * Deterministically decides whether exact advertised operation and live-session evidence permit
 * TypeScript diagnostics. This function never invokes a tool and never interprets `provider`.
 */
export function decideTypeScriptDiagnosticsRequest(
  input: TypeScriptDiagnosticsPolicyInput,
): TypeScriptDiagnosticsDecision {
  if (input.languageId !== "typescript") return refused("invalid-language-id");
  if (!validIdentity(input.workspaceId) || !validIdentity(input.authorizedWorkspaceId)) {
    return refused("invalid-workspace-id");
  }
  if (!positiveGeneration(input.workspaceGeneration)) {
    return refused("workspace-generation-nonpositive");
  }
  if (input.workspaceId !== input.authorizedWorkspaceId) return refused("workspace-unauthorized");
  if (
    !positiveGeneration(input.authorizedWorkspaceGeneration) ||
    input.workspaceGeneration !== input.authorizedWorkspaceGeneration
  ) {
    return refused("workspace-generation-stale");
  }
  if (!validIdentity(input.snapshotHash)) return refused("snapshot-identity-absent");
  if (!SOURCE_EXTENSION.test(input.sourceExtension)) {
    return refused("capability-extensions-unauthorized");
  }

  const languageKernel = input.capabilities.languageKernel;
  if (!languageKernel?.available) return refused("capability-absent");

  const candidates = languageKernel.schema.adapters.flatMap((adapter) =>
    adapter.languageId === input.languageId
      ? adapter.capabilities
          .filter((capability) => capability.operation === "diagnostics")
          .map((capability) => ({ adapter, capability }))
      : [],
  );
  if (candidates.length === 0) return refused("capability-absent");
  if (candidates.length !== 1) return refused("capability-ambiguous");

  const selected = candidates[0]!;
  const capability = selected.capability;
  if (capability.mutationAuthority === "proposal-only") {
    return refused("capability-proposal-inappropriate");
  }
  if (capability.mutationAuthority !== "none") {
    return refused("capability-mutation-authority-inappropriate");
  }
  if (capability.stability !== "stable" && capability.stability !== "experimental") {
    return refused("capability-stability-inappropriate");
  }
  if (capability.evidence !== "compiler" && capability.evidence !== "language-server") {
    return refused("capability-evidence-unqualified");
  }
  if (!validMetadata(capability.backend)) return refused("capability-backend-unauthorized");
  if (!qualifiedRuntime(capability.runtime)) return refused("capability-runtime-unauthorized");
  if (
    !selected.adapter.extensions.includes(input.sourceExtension) ||
    !capability.extensions.includes(input.sourceExtension)
  ) {
    return refused("capability-extensions-unauthorized");
  }

  const session = input.semanticSession;
  if (session.state === "unavailable") return refused("semantic-toolchain-unavailable");
  if (session.qualification !== "qualified") return refused("semantic-toolchain-unqualified");
  if (!validIdentity(session.sessionId)) return refused("invalid-session-id");
  if (
    session.languageId !== input.languageId ||
    session.workspaceId !== input.workspaceId ||
    session.workspaceGeneration !== input.workspaceGeneration
  ) {
    return refused("semantic-session-authority-mismatch");
  }
  if (!session.snapshotHash || !validIdentity(session.snapshotHash)) {
    return refused("semantic-session-hash-unbound");
  }
  if (session.snapshotHash !== input.snapshotHash) {
    return refused("semantic-session-snapshot-mismatch");
  }

  const providerVersion = input.capabilities.providerVersion;
  if (!providerVersion || !validMetadata(providerVersion)) {
    return refused("provider-version-unavailable");
  }
  if (!validMetadata(session.providerVersion) || session.providerVersion !== providerVersion) {
    return refused("provider-version-mismatch");
  }
  if (
    session.toolchain.evidence !== capability.evidence ||
    session.toolchain.backend !== capability.backend ||
    !runtimeEquals(session.toolchain.runtime, capability.runtime) ||
    !stringArrayEquals(session.toolchain.extensions, capability.extensions)
  ) {
    return refused("semantic-toolchain-mismatch");
  }

  const request: TypeScriptDiagnosticsRequest = Object.freeze({
    languageId: "typescript",
    workspaceId: input.workspaceId,
    workspaceGeneration: input.workspaceGeneration,
    sessionId: session.sessionId,
    snapshotHash: input.snapshotHash,
    providerVersion,
    backend: capability.backend,
  });
  return Object.freeze({ kind: "ready", request });
}

function refused(reason: TypeScriptDiagnosticsRefusalReason): TypeScriptDiagnosticsDecision {
  return Object.freeze({ kind: "refused", reason });
}

function validIdentity(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 512 &&
    value.trim() === value &&
    !CONTROL_CHARACTERS.test(value)
  );
}

function validMetadata(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 256 &&
    value.trim() === value &&
    !CONTROL_CHARACTERS.test(value)
  );
}

function positiveGeneration(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function qualifiedRuntime(runtime: RefactorKitLanguageAdapterRuntime): boolean {
  return (
    runtime.supportsTimeout &&
    runtime.supportsCancellation &&
    runtime.usesWorkspaceOverlay &&
    runtime.recordsProcessProvenance &&
    positiveLimit(runtime.limits.requestTimeoutMillis) &&
    positiveLimit(runtime.limits.maxInputBytes) &&
    positiveLimit(runtime.limits.maxOutputBytes) &&
    positiveLimit(runtime.limits.maxProcesses)
  );
}

function positiveLimit(value: number | null): boolean {
  return value !== null && Number.isSafeInteger(value) && value > 0;
}

function runtimeEquals(
  left: RefactorKitLanguageAdapterRuntime,
  right: RefactorKitLanguageAdapterRuntime,
): boolean {
  return (
    left.executionMode === right.executionMode &&
    left.supportsTimeout === right.supportsTimeout &&
    left.supportsCancellation === right.supportsCancellation &&
    left.usesWorkspaceOverlay === right.usesWorkspaceOverlay &&
    left.recordsProcessProvenance === right.recordsProcessProvenance &&
    left.limits.requestTimeoutMillis === right.limits.requestTimeoutMillis &&
    left.limits.maxInputBytes === right.limits.maxInputBytes &&
    left.limits.maxOutputBytes === right.limits.maxOutputBytes &&
    left.limits.maxProcesses === right.limits.maxProcesses
  );
}

function stringArrayEquals(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
