import {
  XCOM2_PROJECT_FOUNDRY_REFUSAL_CODES,
  type Xcom2ProjectFoundryApplyCurrentSelection,
  Xcom2ProjectFoundryApplyRequest,
  Xcom2ProjectFoundryApplyResult,
  Xcom2ProjectFoundryApplyState,
  Xcom2ProjectFoundryDestinationParentSelectionGrant,
  Xcom2ProjectFoundryOperationGrant,
  Xcom2ProjectFoundryPreviewRefusalCode,
  Xcom2ProjectFoundryRenderRequest,
  Xcom2ProjectFoundrySourceSelectionGrant,
} from "@ide/contracts";
import type {
  Xcom2ProjectFoundryDialogCreationState,
  Xcom2ProjectFoundryDialogViewState,
} from "@ide/ui";
import {
  createXcom2ProjectFoundryReadyApplyState,
  createXcom2ProjectFoundryRenderRequest,
  decideXcom2ProjectFoundryApplyTerminalSession,
  mapXcom2ProjectFoundryApplyAttentionPresentation,
  reduceXcom2ProjectFoundryApplyState,
  validateAndDigestXcom2ProjectFoundryRenderedPlan,
  validateXcom2ProjectFoundryModId,
} from "@ide/web-core";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

export interface ProjectFoundryComposition {
  readonly selectors: {
    selectSourceRepository(): Promise<Xcom2ProjectFoundrySourceSelectionGrant>;
    selectDestinationParent(): Promise<Xcom2ProjectFoundryDestinationParentSelectionGrant>;
  };
  readonly renderer: {
    /** Provider data remains unknown until strict TypeScript rendered-plan custody succeeds. */
    renderPreview(request: Readonly<Xcom2ProjectFoundryRenderRequest>): Promise<unknown>;
  };
  /**
   * Optional until a real native Apply adapter exists. Deterministic desktop compositions can
   * inject the provider-neutral one-shot port without granting production Tauri mutation authority.
   */
  apply?(
    request: Readonly<Xcom2ProjectFoundryApplyRequest>,
  ): Promise<Xcom2ProjectFoundryApplyResult>;
  readonly grants: {
    revokeOperation(): Promise<void>;
    revokeAll(): Promise<void>;
  };
}

export interface Xcom2ProjectFoundryController {
  readonly isOpen: boolean;
  readonly sourceRepository: string;
  readonly destinationParent: string;
  readonly modId: string;
  /**
   * Informational Linux path derived from the selected parent and accepted current ModId.
   * This presentation value is never operation authority.
   */
  readonly finalProjectLocation: string;
  readonly viewState: Xcom2ProjectFoundryDialogViewState;
  readonly creationState: Xcom2ProjectFoundryDialogCreationState;
  /** Immutable pure lifecycle snapshot retained for controller diagnostics and tests. */
  readonly applyState: Readonly<Xcom2ProjectFoundryApplyState> | null;
  open(): void;
  selectSourceRepository(): Promise<void>;
  selectDestinationParent(): Promise<void>;
  setModId(modId: string): void;
  preview(modId: string): Promise<void>;
  apply(approvedPlanDigest: string): Promise<void>;
  cancel(): Promise<void>;
}

const EDITING = Object.freeze({ kind: "editing" } as const);
const CREATION_UNAVAILABLE = Object.freeze({ kind: "unavailable" } as const);
const SAFE_APPLY_FAILURE_REASON = "Project creation failed safely.";
const SAFE_PREVIEW_REFUSALS = new Set<string>(XCOM2_PROJECT_FOUNDRY_REFUSAL_CODES);
const GRANT_IDENTITY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function canonicalAbsolutePath(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith("/") || value.includes("\\")) return false;
  if (value === "/") return true;
  if (value.endsWith("/")) return false;
  return value
    .split("/")
    .slice(1)
    .every((component) => component.length > 0 && component !== "." && component !== "..");
}

/** Presentation-only path derivation. Native renderer authority remains grant based. */
function informationalFinalProjectLocation(
  destinationParentGrant: Readonly<Xcom2ProjectFoundryDestinationParentSelectionGrant> | null,
  exactModId: string,
): string {
  if (!destinationParentGrant || validateXcom2ProjectFoundryModId(exactModId).kind === "refused") {
    return "";
  }
  return destinationParentGrant.parent === "/"
    ? `/${exactModId}`
    : `${destinationParentGrant.parent}/${exactModId}`;
}

function snapshotSourceGrant(
  value: unknown,
): Readonly<Xcom2ProjectFoundrySourceSelectionGrant> | null {
  const grant = exactDataRecord(value, ["kind", "repository", "identity"]);
  if (
    !grant ||
    grant.kind !== "source-repository" ||
    !canonicalAbsolutePath(grant.repository) ||
    typeof grant.identity !== "string" ||
    !GRANT_IDENTITY_PATTERN.test(grant.identity)
  ) {
    return null;
  }
  return Object.freeze({
    kind: "source-repository",
    repository: grant.repository,
    identity: grant.identity,
  });
}

function snapshotDestinationGrant(
  value: unknown,
): Readonly<Xcom2ProjectFoundryDestinationParentSelectionGrant> | null {
  const grant = exactDataRecord(value, ["kind", "parent", "identity"]);
  if (
    !grant ||
    grant.kind !== "destination-parent" ||
    !canonicalAbsolutePath(grant.parent) ||
    typeof grant.identity !== "string" ||
    !GRANT_IDENTITY_PATTERN.test(grant.identity)
  ) {
    return null;
  }
  return Object.freeze({
    kind: "destination-parent",
    parent: grant.parent,
    identity: grant.identity,
  });
}

function exactDataRecord(
  value: unknown,
  fields: readonly string[],
): Readonly<Record<string, unknown>> | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== fields.length ||
      keys.some((key) => typeof key !== "string" || !fields.includes(key)) ||
      fields.some((field) => !keys.includes(field))
    ) {
      return null;
    }
    const snapshot: Record<string, unknown> = {};
    for (const field of fields) {
      const descriptor = Object.getOwnPropertyDescriptor(value, field);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
      snapshot[field] = descriptor.value;
    }
    return snapshot;
  } catch {
    return null;
  }
}

function snapshotNativeRefusal(
  value: unknown,
): Readonly<{ kind: "refused"; code: Xcom2ProjectFoundryPreviewRefusalCode }> | null {
  const refusal = exactDataRecord(value, ["kind", "code"]);
  if (
    !refusal ||
    refusal.kind !== "refused" ||
    typeof refusal.code !== "string" ||
    !SAFE_PREVIEW_REFUSALS.has(refusal.code)
  ) {
    return null;
  }
  return Object.freeze({
    kind: "refused",
    code: refusal.code as Xcom2ProjectFoundryPreviewRefusalCode,
  });
}

/** Snapshot only an exact plain Apply result before it reaches the pure reducer. */
function snapshotApplyResult(value: unknown): Readonly<Xcom2ProjectFoundryApplyResult> | null {
  let resultKind: unknown;
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, "result");
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
    resultKind = descriptor.value;
  } catch {
    return null;
  }
  if (typeof resultKind !== "string") return null;

  if (resultKind === "created") {
    const result = exactDataRecord(value, [
      "result",
      "planDigest",
      "finalProjectLocation",
      "sourceCommit",
      "sourceTree",
      "committedDirectories",
      "committedFiles",
    ]);
    if (
      !result ||
      result.result !== "created" ||
      typeof result.planDigest !== "string" ||
      typeof result.finalProjectLocation !== "string" ||
      typeof result.sourceCommit !== "string" ||
      typeof result.sourceTree !== "string" ||
      typeof result.committedDirectories !== "number" ||
      !Number.isSafeInteger(result.committedDirectories) ||
      typeof result.committedFiles !== "number" ||
      !Number.isSafeInteger(result.committedFiles)
    ) {
      return null;
    }
    return Object.freeze({
      result: "created",
      planDigest: result.planDigest,
      finalProjectLocation: result.finalProjectLocation,
      sourceCommit: result.sourceCommit,
      sourceTree: result.sourceTree,
      committedDirectories: result.committedDirectories,
      committedFiles: result.committedFiles,
    });
  }

  if (resultKind === "refused" || resultKind === "failed") {
    const result = exactDataRecord(value, ["result", "phase", "reason"]);
    if (
      !result ||
      result.result !== resultKind ||
      result.phase !== "pre-commit" ||
      typeof result.reason !== "string"
    ) {
      return null;
    }
    return Object.freeze({
      result: resultKind,
      phase: "pre-commit",
      reason: result.reason,
    }) as Readonly<Xcom2ProjectFoundryApplyResult>;
  }

  if (resultKind === "created-recovery-required") {
    const result = exactDataRecord(value, [
      "result",
      "phase",
      "planDigest",
      "finalProjectLocation",
      "reason",
    ]);
    if (
      !result ||
      result.result !== "created-recovery-required" ||
      result.phase !== "post-commit" ||
      typeof result.planDigest !== "string" ||
      typeof result.finalProjectLocation !== "string" ||
      typeof result.reason !== "string"
    ) {
      return null;
    }
    return Object.freeze({
      result: "created-recovery-required",
      phase: "post-commit",
      planDigest: result.planDigest,
      finalProjectLocation: result.finalProjectLocation,
      reason: result.reason,
    });
  }

  return null;
}

/**
 * Desktop orchestration for native Project Foundry rendering and an optional one-shot Apply port.
 * Selection grants are retained independently from renderer-minted operation authority.
 */
export function useXcom2ProjectFoundryController(
  composition?: ProjectFoundryComposition,
): Xcom2ProjectFoundryController {
  const compositionRef = useRef(composition);
  compositionRef.current = composition;
  const previousCompositionRef = useRef(composition);
  const mountedRef = useRef(true);
  const openRef = useRef(false);
  const sessionGenerationRef = useRef(0);
  const sourceGenerationRef = useRef(0);
  const destinationGenerationRef = useRef(0);
  const previewGenerationRef = useRef(0);
  const authorityQueueRef = useRef<Promise<void>>(Promise.resolve());
  const renderQueueRef = useRef<Promise<void>>(Promise.resolve());
  const renderIdleRef = useRef(true);
  const operationRevocationRef = useRef<Promise<void>>(Promise.resolve());
  const operationRevocationPendingRef = useRef(false);
  const sourceGrantRef = useRef<Readonly<Xcom2ProjectFoundrySourceSelectionGrant> | null>(null);
  const destinationGrantRef =
    useRef<Readonly<Xcom2ProjectFoundryDestinationParentSelectionGrant> | null>(null);
  const operationGrantRef = useRef<Readonly<Xcom2ProjectFoundryOperationGrant> | null>(null);
  const nativeRenderCountRef = useRef(0);
  const modIdRef = useRef("");
  const applyStateRef = useRef<Readonly<Xcom2ProjectFoundryApplyState> | null>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [sourceRepository, setSourceRepository] = useState("");
  const [destinationParent, setDestinationParent] = useState("");
  const [modId, setModIdState] = useState("");
  const [finalProjectLocation, setFinalProjectLocation] = useState("");
  const [viewState, setViewState] = useState<Xcom2ProjectFoundryDialogViewState>(EDITING);
  const [creationState, setCreationState] =
    useState<Xcom2ProjectFoundryDialogCreationState>(CREATION_UNAVAILABLE);
  const [applyState, setApplyState] = useState<Readonly<Xcom2ProjectFoundryApplyState> | null>(
    null,
  );

  const enqueueAuthority = useCallback(<T>(operation: () => Promise<T>): Promise<T> => {
    const result = authorityQueueRef.current.then(operation, operation);
    authorityQueueRef.current = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }, []);

  const enqueueRender = useCallback(<T>(operation: () => Promise<T>): Promise<T> => {
    let result: Promise<T>;
    if (renderIdleRef.current) {
      renderIdleRef.current = false;
      try {
        result = Promise.resolve(operation());
      } catch (error) {
        result = Promise.reject(error);
      }
    } else {
      result = renderQueueRef.current.then(operation, operation);
    }
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    renderQueueRef.current = tail;
    void tail.then(() => {
      if (renderQueueRef.current === tail) renderIdleRef.current = true;
    });
    return result;
  }, []);

  const revokeAllSafely = useCallback(async (owner?: ProjectFoundryComposition): Promise<void> => {
    if (!owner) return;
    try {
      await owner.grants.revokeAll();
    } catch {
      // Provider diagnostics and paths never enter presentation state.
    }
  }, []);

  const startOperationRevocation = useCallback(
    (owner?: ProjectFoundryComposition): Promise<void> => {
      if (!owner) return Promise.resolve();
      let started: Promise<void>;
      try {
        // Calling the port directly starts revocation before this synchronous turn returns.
        started = Promise.resolve(owner.grants.revokeOperation());
      } catch {
        started = Promise.resolve();
      }
      const safe = started.catch(() => undefined);
      const prior = operationRevocationRef.current;
      const barrier = Promise.all([prior, safe]).then(() => undefined);
      operationRevocationPendingRef.current = true;
      operationRevocationRef.current = barrier;
      void barrier.then(() => {
        if (operationRevocationRef.current === barrier) {
          operationRevocationPendingRef.current = false;
        }
      });
      return barrier;
    },
    [],
  );

  const clearGrantMemory = useCallback((): void => {
    sourceGrantRef.current = null;
    destinationGrantRef.current = null;
    operationGrantRef.current = null;
  }, []);

  const clearRenderedGrants = useCallback((): void => {
    if (!mountedRef.current) return;
    setSourceRepository("");
    setDestinationParent("");
    setFinalProjectLocation("");
  }, []);

  const publishInformationalFinalProjectLocation = useCallback(
    (destinationGrant = destinationGrantRef.current, exactModId = modIdRef.current): void => {
      if (!mountedRef.current) return;
      setFinalProjectLocation(informationalFinalProjectLocation(destinationGrant, exactModId));
    },
    [],
  );

  const clearAuthorityMemory = useCallback((): void => {
    clearGrantMemory();
    modIdRef.current = "";
    applyStateRef.current = null;
  }, [clearGrantMemory]);

  const clearRenderedMemory = useCallback((): void => {
    clearRenderedGrants();
    setModIdState("");
    setViewState(EDITING);
    setCreationState(CREATION_UNAVAILABLE);
    setApplyState(null);
  }, [clearRenderedGrants]);

  const invalidateReadyApproval = useCallback((): boolean => {
    const retainedReadyPreview = applyStateRef.current?.status === "ready";
    applyStateRef.current = null;
    if (mountedRef.current) {
      setApplyState(null);
      setCreationState(retainedReadyPreview ? { kind: "consumed" } : CREATION_UNAVAILABLE);
    }
    return retainedReadyPreview;
  }, []);

  const clearPreviewAuthority = useCallback(
    (consumeReady = true): boolean => {
      previewGenerationRef.current += 1;
      operationGrantRef.current = null;
      if (mountedRef.current) setFinalProjectLocation("");
      const retainedReady = invalidateReadyApproval();
      if (mountedRef.current) {
        setViewState(EDITING);
        if (!consumeReady && retainedReady) setCreationState(CREATION_UNAVAILABLE);
      }
      return retainedReady;
    },
    [invalidateReadyApproval],
  );

  const invalidateAll = useCallback((): number => {
    const generation = ++sessionGenerationRef.current;
    sourceGenerationRef.current += 1;
    destinationGenerationRef.current += 1;
    previewGenerationRef.current += 1;
    return generation;
  }, []);

  const authorityConsumed = useCallback(
    (): boolean => applyStateRef.current?.authority === "consumed",
    [],
  );

  const open = useCallback((): void => {
    const owner = compositionRef.current;
    const hadAuthority =
      sourceGrantRef.current !== null ||
      destinationGrantRef.current !== null ||
      operationGrantRef.current !== null;
    invalidateAll();
    clearAuthorityMemory();
    clearRenderedMemory();
    openRef.current = true;
    setIsOpen(true);
    if (hadAuthority) void enqueueAuthority(() => revokeAllSafely(owner));
  }, [clearAuthorityMemory, clearRenderedMemory, enqueueAuthority, invalidateAll, revokeAllSafely]);

  const prepareSelection = useCallback(
    (owner: ProjectFoundryComposition, replacement: boolean): Promise<void> =>
      replacement ? revokeAllSafely(owner) : Promise.resolve(),
    [revokeAllSafely],
  );

  const selectSourceRepository = useCallback(async (): Promise<void> => {
    const owner = compositionRef.current;
    if (authorityConsumed()) return;
    if (!owner || !openRef.current) {
      if (openRef.current) setViewState({ kind: "refused", code: "source-grant-invalid" });
      return;
    }
    const session = sessionGenerationRef.current;
    const selectionGeneration = ++sourceGenerationRef.current;
    const replacement = sourceGrantRef.current !== null || operationGrantRef.current !== null;
    clearPreviewAuthority();
    if (replacement) {
      clearGrantMemory();
      clearRenderedGrants();
    }

    await enqueueAuthority(async () => {
      const isCurrent = (): boolean =>
        mountedRef.current &&
        openRef.current &&
        compositionRef.current === owner &&
        sessionGenerationRef.current === session &&
        sourceGenerationRef.current === selectionGeneration &&
        !authorityConsumed();
      if (!isCurrent()) return;
      await prepareSelection(owner, replacement);
      if (!isCurrent()) return;

      let selected: unknown;
      try {
        selected = await owner.selectors.selectSourceRepository();
      } catch {
        await revokeAllSafely(owner);
        clearGrantMemory();
        clearRenderedGrants();
        if (isCurrent()) setViewState({ kind: "refused", code: "source-grant-invalid" });
        return;
      }
      if (!isCurrent()) {
        await revokeAllSafely(owner);
        clearGrantMemory();
        clearRenderedGrants();
        return;
      }
      const grant = snapshotSourceGrant(selected);
      if (!grant) {
        await revokeAllSafely(owner);
        clearGrantMemory();
        clearRenderedGrants();
        setViewState({ kind: "refused", code: "source-grant-invalid" });
        return;
      }
      sourceGrantRef.current = grant;
      flushSync(() => {
        setSourceRepository(grant.repository);
        publishInformationalFinalProjectLocation();
      });
    });
  }, [
    authorityConsumed,
    clearGrantMemory,
    clearPreviewAuthority,
    clearRenderedGrants,
    enqueueAuthority,
    prepareSelection,
    publishInformationalFinalProjectLocation,
    revokeAllSafely,
  ]);

  const selectDestinationParent = useCallback(async (): Promise<void> => {
    const owner = compositionRef.current;
    if (authorityConsumed()) return;
    if (!owner || !openRef.current) {
      if (openRef.current) {
        setViewState({ kind: "refused", code: "destination-parent-grant-invalid" });
      }
      return;
    }
    const session = sessionGenerationRef.current;
    const selectionGeneration = ++destinationGenerationRef.current;
    const replacement = destinationGrantRef.current !== null || operationGrantRef.current !== null;
    clearPreviewAuthority();
    if (replacement) {
      clearGrantMemory();
      clearRenderedGrants();
    }

    await enqueueAuthority(async () => {
      const isCurrent = (): boolean =>
        mountedRef.current &&
        openRef.current &&
        compositionRef.current === owner &&
        sessionGenerationRef.current === session &&
        destinationGenerationRef.current === selectionGeneration &&
        !authorityConsumed();
      if (!isCurrent()) return;
      await prepareSelection(owner, replacement);
      if (!isCurrent()) return;

      let selected: unknown;
      try {
        selected = await owner.selectors.selectDestinationParent();
      } catch {
        await revokeAllSafely(owner);
        clearGrantMemory();
        clearRenderedGrants();
        if (isCurrent()) {
          setViewState({ kind: "refused", code: "destination-parent-grant-invalid" });
        }
        return;
      }
      if (!isCurrent()) {
        await revokeAllSafely(owner);
        clearGrantMemory();
        clearRenderedGrants();
        return;
      }
      const grant = snapshotDestinationGrant(selected);
      if (!grant) {
        await revokeAllSafely(owner);
        clearGrantMemory();
        clearRenderedGrants();
        setViewState({ kind: "refused", code: "destination-parent-grant-invalid" });
        return;
      }
      destinationGrantRef.current = grant;
      flushSync(() => {
        setDestinationParent(grant.parent);
        publishInformationalFinalProjectLocation(grant);
      });
    });
  }, [
    authorityConsumed,
    clearGrantMemory,
    clearPreviewAuthority,
    clearRenderedGrants,
    enqueueAuthority,
    prepareSelection,
    publishInformationalFinalProjectLocation,
    revokeAllSafely,
  ]);

  const setModId = useCallback(
    (nextModId: string): void => {
      if (authorityConsumed() || nextModId === modIdRef.current) return;
      const owner = compositionRef.current;
      const requiresOperationRevocation =
        operationGrantRef.current !== null || nativeRenderCountRef.current > 0;
      modIdRef.current = nextModId;
      clearPreviewAuthority();
      setModIdState(nextModId);
      publishInformationalFinalProjectLocation(destinationGrantRef.current, nextModId);
      if (requiresOperationRevocation) void startOperationRevocation(owner);
    },
    [
      authorityConsumed,
      clearPreviewAuthority,
      publishInformationalFinalProjectLocation,
      startOperationRevocation,
    ],
  );

  const preview = useCallback(
    async (exactModId: string): Promise<void> => {
      if (!openRef.current || authorityConsumed()) return;
      const owner = compositionRef.current;
      if (exactModId !== modIdRef.current) {
        const requiresOperationRevocation =
          operationGrantRef.current !== null || nativeRenderCountRef.current > 0;
        modIdRef.current = exactModId;
        clearPreviewAuthority();
        setModIdState(exactModId);
        if (requiresOperationRevocation) void startOperationRevocation(owner);
      } else if (operationGrantRef.current !== null) {
        clearPreviewAuthority();
        void startOperationRevocation(owner);
      } else {
        invalidateReadyApproval();
      }

      const validation = validateXcom2ProjectFoundryModId(exactModId);
      if (validation.kind === "refused") {
        previewGenerationRef.current += 1;
        setFinalProjectLocation("");
        setViewState(validation);
        return;
      }
      publishInformationalFinalProjectLocation(destinationGrantRef.current, exactModId);

      const sourceGrant = sourceGrantRef.current;
      const destinationParentGrant = destinationGrantRef.current;
      if (!owner || !sourceGrant) {
        setViewState({ kind: "refused", code: "source-grant-invalid" });
        return;
      }
      if (!destinationParentGrant) {
        setViewState({ kind: "refused", code: "destination-parent-grant-invalid" });
        return;
      }

      let request: Readonly<Xcom2ProjectFoundryRenderRequest>;
      try {
        request = createXcom2ProjectFoundryRenderRequest({
          sourceGrant,
          destinationParentGrant,
          modId: exactModId,
        });
      } catch {
        setViewState({ kind: "refused", code: "rendered-plan-invalid" });
        return;
      }

      const session = sessionGenerationRef.current;
      const previewGeneration = ++previewGenerationRef.current;
      const current = (): boolean =>
        mountedRef.current &&
        openRef.current &&
        compositionRef.current === owner &&
        sessionGenerationRef.current === session &&
        previewGenerationRef.current === previewGeneration &&
        modIdRef.current === exactModId &&
        !authorityConsumed();
      setViewState({ kind: "busy" });

      await enqueueRender(async () => {
        if (operationRevocationPendingRef.current) await operationRevocationRef.current;
        if (!current()) return;
        let rendered: unknown;
        nativeRenderCountRef.current += 1;
        try {
          rendered = await owner.renderer.renderPreview(request);
        } catch {
          if (current()) setViewState({ kind: "refused", code: "rendered-plan-invalid" });
          await startOperationRevocation(owner);
          return;
        } finally {
          nativeRenderCountRef.current -= 1;
        }
        if (!current()) {
          await startOperationRevocation(owner);
          return;
        }
        const nativeRefusal = snapshotNativeRefusal(rendered);
        if (nativeRefusal) {
          setViewState(nativeRefusal);
          return;
        }

        const validated = validateAndDigestXcom2ProjectFoundryRenderedPlan(request, rendered);
        if (!current()) {
          await startOperationRevocation(owner);
          return;
        }
        if (validated.kind !== "ready") {
          setViewState({ kind: "refused", code: "rendered-plan-invalid" });
          await startOperationRevocation(owner);
          return;
        }

        const operationGrant = validated.operationGrant;
        operationGrantRef.current = operationGrant;
        const previewResult = Object.freeze({ kind: "ready" as const, plan: validated.plan });
        const currentSelection: Xcom2ProjectFoundryApplyCurrentSelection = {
          sourceGrant,
          destinationParentGrant,
          operationGrant,
          modId: exactModId,
        };
        const readyApplyState = createXcom2ProjectFoundryReadyApplyState({
          preview: previewResult,
          current: currentSelection,
        });
        applyStateRef.current = readyApplyState;
        setApplyState(readyApplyState);
        setCreationState(
          typeof owner.apply === "function" ? { kind: "ready" } : CREATION_UNAVAILABLE,
        );
        setViewState(previewResult);
      });
    },
    [
      authorityConsumed,
      clearPreviewAuthority,
      enqueueRender,
      invalidateReadyApproval,
      publishInformationalFinalProjectLocation,
      startOperationRevocation,
    ],
  );

  const apply = useCallback(
    async (approvedPlanDigest: string): Promise<void> => {
      if (!openRef.current) return;
      const owner = compositionRef.current;
      const state = applyStateRef.current;
      if (!owner || typeof owner.apply !== "function" || !state) return;

      const prepared = reduceXcom2ProjectFoundryApplyState(state, {
        kind: "apply-requested",
        approvedPlanDigest,
      });
      if (prepared.kind !== "prepared") return;

      applyStateRef.current = prepared.state;
      flushSync(() => {
        setApplyState(prepared.state);
        setCreationState({ kind: "creating" });
      });

      const session = sessionGenerationRef.current;
      const request = prepared.request;
      await enqueueAuthority(async () => {
        const isCurrent = (): boolean =>
          mountedRef.current &&
          openRef.current &&
          compositionRef.current === owner &&
          sessionGenerationRef.current === session &&
          applyStateRef.current === prepared.state;
        if (!isCurrent()) return;

        let result: Readonly<Xcom2ProjectFoundryApplyResult>;
        try {
          const providerResult = await owner.apply!(request);
          result =
            snapshotApplyResult(providerResult) ??
            Object.freeze({
              result: "failed",
              phase: "pre-commit",
              reason: SAFE_APPLY_FAILURE_REASON,
            });
        } catch {
          result = Object.freeze({
            result: "failed",
            phase: "pre-commit",
            reason: SAFE_APPLY_FAILURE_REASON,
          });
        }
        if (!isCurrent()) return;

        const completion = reduceXcom2ProjectFoundryApplyState(prepared.state, {
          kind: "apply-completed",
          result,
        });
        const createdState =
          completion.kind === "transitioned" && completion.state.status === "created"
            ? completion.state
            : null;
        let publishedState = completion.state;
        let attention: Extract<
          Xcom2ProjectFoundryDialogCreationState,
          { kind: "attention" }
        > | null = null;
        if (!createdState) {
          const presentation = mapXcom2ProjectFoundryApplyAttentionPresentation(result);
          const terminalResult: Readonly<Xcom2ProjectFoundryApplyResult> =
            result.result === "refused" &&
            result.phase === "pre-commit" &&
            result.reason === "destination-present"
              ? result
              : Object.freeze({
                  result: "refused",
                  phase: "pre-commit",
                  reason: SAFE_APPLY_FAILURE_REASON,
                });
          const terminalReduction = reduceXcom2ProjectFoundryApplyState(prepared.state, {
            kind: "apply-completed",
            result: terminalResult,
          });
          if (
            terminalReduction.kind !== "transitioned" ||
            terminalReduction.state.status !== "refused"
          ) {
            throw new Error("Project Foundry terminal state invariant failed");
          }
          publishedState = terminalReduction.state;
          attention = {
            kind: "attention",
            presentation,
            terminalDecision: decideXcom2ProjectFoundryApplyTerminalSession(
              terminalReduction.state,
            ),
          };
        }

        applyStateRef.current = publishedState;
        clearGrantMemory();
        if (mountedRef.current) {
          if (createdState) {
            // Preserve the established successful completion behavior.
            setApplyState(createdState);
            setCreationState({ kind: "created", receipt: createdState.receipt });
          } else {
            flushSync(() => {
              setApplyState(publishedState);
              setCreationState(attention!);
            });
          }
        }
        await revokeAllSafely(owner);
      });
    },
    [clearGrantMemory, enqueueAuthority, revokeAllSafely],
  );

  const cancel = useCallback(async (): Promise<void> => {
    const owner = compositionRef.current;
    invalidateAll();
    openRef.current = false;
    clearAuthorityMemory();
    if (mountedRef.current) {
      setIsOpen(false);
      clearRenderedMemory();
    }
    await enqueueAuthority(() => revokeAllSafely(owner));
  }, [clearAuthorityMemory, clearRenderedMemory, enqueueAuthority, invalidateAll, revokeAllSafely]);

  useEffect(() => {
    const previous = previousCompositionRef.current;
    if (previous === composition) return;
    previousCompositionRef.current = composition;
    invalidateAll();
    openRef.current = false;
    clearAuthorityMemory();
    setIsOpen(false);
    clearRenderedMemory();
    void enqueueAuthority(() => revokeAllSafely(previous));
  }, [
    clearAuthorityMemory,
    clearRenderedMemory,
    composition,
    enqueueAuthority,
    invalidateAll,
    revokeAllSafely,
  ]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const owner = compositionRef.current;
      invalidateAll();
      openRef.current = false;
      clearAuthorityMemory();
      void enqueueAuthority(() => revokeAllSafely(owner));
    };
  }, [clearAuthorityMemory, enqueueAuthority, invalidateAll, revokeAllSafely]);

  return {
    isOpen,
    sourceRepository,
    destinationParent,
    modId,
    finalProjectLocation,
    viewState,
    creationState,
    applyState,
    open,
    selectSourceRepository,
    selectDestinationParent,
    setModId,
    preview,
    apply,
    cancel,
  };
}
