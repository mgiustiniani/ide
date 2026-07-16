import {
  XCOM2_MODULE_EVIDENCE_KINDS,
  type Xcom2ModuleActivationDecision,
  type Xcom2ModuleActivationReason,
  type Xcom2ModuleActivationSnapshot,
  type Xcom2ModuleEvidenceKind,
  type Xcom2ModuleEvidenceObservation,
  type Xcom2ModuleScanSnapshot,
} from "@ide/contracts";

const EVIDENCE_KIND_ORDER = new Map<Xcom2ModuleEvidenceKind, number>(
  XCOM2_MODULE_EVIDENCE_KINDS.map((kind, index) => [kind, index]),
);

function compareLexically(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isKnownEvidenceKind(value: unknown): value is Xcom2ModuleEvidenceKind {
  return EVIDENCE_KIND_ORDER.has(value as Xcom2ModuleEvidenceKind);
}

function isUsableObservation(
  observation: Readonly<Xcom2ModuleEvidenceObservation>,
): observation is Readonly<Xcom2ModuleEvidenceObservation> {
  return (
    isKnownEvidenceKind(observation.evidenceKind) &&
    typeof observation.moduleRoot === "string" &&
    typeof observation.relativePath === "string"
  );
}

function compareReasons(
  left: Readonly<Xcom2ModuleActivationReason>,
  right: Readonly<Xcom2ModuleActivationReason>,
): number {
  const kindDifference =
    EVIDENCE_KIND_ORDER.get(left.evidenceKind)! - EVIDENCE_KIND_ORDER.get(right.evidenceKind)!;

  return kindDifference || compareLexically(left.relativePath, right.relativePath);
}

function createDecision(
  moduleRoot: string,
  observations: readonly Readonly<Xcom2ModuleEvidenceObservation>[],
): Readonly<Xcom2ModuleActivationDecision> {
  const distinctKinds = new Set(observations.map(({ evidenceKind }) => evidenceKind)).size;
  const active = distinctKinds >= 2;
  const reasons = Object.freeze(
    observations
      .map(({ evidenceKind, relativePath }) =>
        Object.freeze({ evidenceKind, relativePath } satisfies Xcom2ModuleActivationReason),
      )
      .sort(compareReasons),
  );

  return Object.freeze({
    moduleRoot,
    state: active ? "active" : "needs-confirmation",
    confidence: active ? "high" : "medium",
    reasons,
  });
}

/**
 * Evaluate scanner-established convention evidence without performing any platform access.
 * Only distinct evidence kinds at the exact same canonical module root corroborate activation.
 */
export function evaluateXcom2ModuleActivation(
  snapshot: Readonly<Xcom2ModuleScanSnapshot>,
): Readonly<Xcom2ModuleActivationSnapshot> {
  const observationsByRoot = new Map<string, Array<Readonly<Xcom2ModuleEvidenceObservation>>>();

  for (const observation of snapshot.observations) {
    if (!isUsableObservation(observation)) continue;

    const observations = observationsByRoot.get(observation.moduleRoot);
    if (observations) observations.push(observation);
    else observationsByRoot.set(observation.moduleRoot, [observation]);
  }

  const decisions = Object.freeze(
    [...observationsByRoot.entries()]
      .sort(([leftRoot], [rightRoot]) => compareLexically(leftRoot, rightRoot))
      .map(([moduleRoot, observations]) => createDecision(moduleRoot, observations)),
  );
  const hasActiveDecision = decisions.some(({ state }) => state === "active");
  const hasDecision = decisions.length > 0;
  const issues = Object.freeze(
    snapshot.issues.map(({ kind, relativePath }) => Object.freeze({ kind, relativePath })),
  );
  const limits = Object.freeze({
    maximumDepth: snapshot.limits.maximumDepth,
    maximumEncounteredEntries: snapshot.limits.maximumEncounteredEntries,
  });

  return Object.freeze({
    workspaceId: snapshot.workspaceId,
    workspaceGeneration: snapshot.workspaceGeneration,
    scanId: snapshot.scanId,
    scanGeneration: snapshot.scanGeneration,
    state: hasActiveDecision ? "active" : hasDecision ? "needs-confirmation" : "inactive",
    confidence: hasActiveDecision ? "high" : hasDecision ? "medium" : "none",
    completeness: snapshot.completeness,
    issues,
    limits,
    decisions,
  });
}

/** Select active module decisions without exposing a mutable collection. */
export function selectActiveXcom2ModuleDecisions(
  snapshot: Readonly<Xcom2ModuleActivationSnapshot>,
): readonly Readonly<Xcom2ModuleActivationDecision>[] {
  return Object.freeze(snapshot.decisions.filter(({ state }) => state === "active"));
}
