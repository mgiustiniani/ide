import type {
  Xcom2ProjectFoundryApplyCurrentSelection,
  Xcom2ProjectFoundryApplyRequest,
  Xcom2ProjectFoundryApplyResult,
  Xcom2ProjectFoundryApplyState,
  Xcom2ProjectFoundryDestinationParentSelectionGrant,
  Xcom2ProjectFoundryDestinationState,
  Xcom2ProjectFoundryOperationGrant,
  Xcom2ProjectFoundrySourceObjectEvidence,
  Xcom2ProjectFoundrySourceSelectionGrant,
} from "@ide/contracts";
import type {
  Xcom2ProjectFoundryDialogCreationState,
  Xcom2ProjectFoundryDialogViewState,
} from "@ide/ui";
import {
  createXcom2ProjectFoundryPreviewRequest,
  createXcom2ProjectFoundryReadyApplyState,
  previewXcom2ProjectFoundry,
  reduceXcom2ProjectFoundryApplyState,
  validateXcom2ProjectFoundryModId,
} from "@ide/web-core";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

export interface ProjectFoundryComposition {
  readonly selectors: {
    selectSourceRepository(): Promise<Xcom2ProjectFoundrySourceSelectionGrant>;
    /** The optional exact ModId lets native selectors pre-bind a destination without excluding no-arg providers. */
    selectDestinationParent(modId?: string): Promise<{
      readonly destinationParentGrant: Xcom2ProjectFoundryDestinationParentSelectionGrant;
      readonly operationGrant: Xcom2ProjectFoundryOperationGrant;
    }>;
  };
  readonly source: {
    resolvePinnedObject(
      grant: Xcom2ProjectFoundrySourceSelectionGrant,
    ): Promise<Xcom2ProjectFoundrySourceObjectEvidence>;
  };
  readonly destination: {
    inspectDerivedDestination(
      destinationParentGrant: Xcom2ProjectFoundryDestinationParentSelectionGrant,
      operationGrant: Xcom2ProjectFoundryOperationGrant,
    ): Promise<Xcom2ProjectFoundryDestinationState>;
  };
  /**
   * Optional until a real native Apply adapter exists. Deterministic desktop compositions can
   * inject the provider-neutral one-shot port without granting production Tauri mutation authority.
   */
  apply?(
    request: Readonly<Xcom2ProjectFoundryApplyRequest>,
  ): Promise<Xcom2ProjectFoundryApplyResult>;
  readonly grants: {
    revokeAll(): Promise<void>;
  };
}

export interface Xcom2ProjectFoundryController {
  readonly isOpen: boolean;
  readonly sourceRepository: string;
  readonly destinationParent: string;
  readonly modId: string;
  /** Exact value copied from the current operation grant; never reconstructed in the App or UI. */
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

type DestinationSelection = {
  readonly destinationParentGrant: Readonly<Xcom2ProjectFoundryDestinationParentSelectionGrant>;
  readonly operationGrant: Readonly<Xcom2ProjectFoundryOperationGrant>;
};

function snapshotSourceGrant(
  value: unknown,
): Readonly<Xcom2ProjectFoundrySourceSelectionGrant> | null {
  if (value === null || typeof value !== "object") return null;
  const grant = value as Record<string, unknown>;
  if (
    grant.kind !== "source-repository" ||
    typeof grant.repository !== "string" ||
    typeof grant.identity !== "string"
  ) {
    return null;
  }
  return Object.freeze({
    kind: "source-repository",
    repository: grant.repository,
    identity: grant.identity,
  });
}

function snapshotDestinationSelection(value: unknown): DestinationSelection | null {
  if (value === null || typeof value !== "object") return null;
  const selection = value as Record<string, unknown>;
  const destination = selection.destinationParentGrant;
  const operation = selection.operationGrant;
  if (
    destination === null ||
    typeof destination !== "object" ||
    operation === null ||
    typeof operation !== "object"
  ) {
    return null;
  }
  const destinationGrant = destination as Record<string, unknown>;
  const operationGrant = operation as Record<string, unknown>;
  if (
    destinationGrant.kind !== "destination-parent" ||
    typeof destinationGrant.parent !== "string" ||
    typeof destinationGrant.identity !== "string" ||
    operationGrant.kind !== "preview-operation" ||
    typeof operationGrant.derivedDestination !== "string" ||
    typeof operationGrant.identity !== "string"
  ) {
    return null;
  }
  return Object.freeze({
    destinationParentGrant: Object.freeze({
      kind: "destination-parent",
      parent: destinationGrant.parent,
      identity: destinationGrant.identity,
    }),
    operationGrant: Object.freeze({
      kind: "preview-operation",
      derivedDestination: operationGrant.derivedDestination,
      identity: operationGrant.identity,
    }),
  });
}

function snapshotSourceEvidence(
  value: unknown,
): Readonly<Xcom2ProjectFoundrySourceObjectEvidence> | null {
  if (value === null || typeof value !== "object") return null;
  const evidence = value as Record<string, unknown>;
  if (
    typeof evidence.commit !== "string" ||
    typeof evidence.tree !== "string" ||
    typeof evidence.fingerprintResult !== "string"
  ) {
    return null;
  }
  return Object.freeze({
    commit: evidence.commit,
    tree: evidence.tree,
    fingerprintResult: evidence.fingerprintResult,
  } as Xcom2ProjectFoundrySourceObjectEvidence);
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
 * Provider-neutral desktop orchestration for Project Foundry preview and an injected one-shot
 * Apply port. Authority is serialized, generation-checked, consumed before port entry, and
 * explicitly revoked. No workspace, editor, process, or filesystem side effect is performed here.
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
  const sourceGrantRef = useRef<Readonly<Xcom2ProjectFoundrySourceSelectionGrant> | null>(null);
  const destinationSelectionRef = useRef<DestinationSelection | null>(null);
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

  const revokeSafely = useCallback(async (owner?: ProjectFoundryComposition): Promise<void> => {
    if (!owner) return;
    try {
      await owner.grants.revokeAll();
    } catch {
      // Revocation failures are deliberately not exposed as provider diagnostics.
    }
  }, []);

  const clearGrantMemory = useCallback((): void => {
    sourceGrantRef.current = null;
    destinationSelectionRef.current = null;
  }, []);

  const clearRenderedGrants = useCallback((): void => {
    if (!mountedRef.current) return;
    setSourceRepository("");
    setDestinationParent("");
    setFinalProjectLocation("");
  }, []);

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
      sourceGrantRef.current !== null || destinationSelectionRef.current !== null;
    invalidateAll();
    clearAuthorityMemory();
    clearRenderedMemory();
    openRef.current = true;
    setIsOpen(true);
    if (hadAuthority) void enqueueAuthority(() => revokeSafely(owner));
  }, [clearAuthorityMemory, clearRenderedMemory, enqueueAuthority, invalidateAll, revokeSafely]);

  const selectSourceRepository = useCallback(async (): Promise<void> => {
    const owner = compositionRef.current;
    if (authorityConsumed()) return;
    if (!owner || !openRef.current) {
      if (openRef.current) setViewState({ kind: "refused", code: "source-grant-invalid" });
      return;
    }
    const session = sessionGenerationRef.current;
    const selectionGeneration = ++sourceGenerationRef.current;
    previewGenerationRef.current += 1;
    const retainedReadyPreview = invalidateReadyApproval();
    if (!retainedReadyPreview) setViewState(EDITING);

    await enqueueAuthority(async () => {
      const isCurrent = (): boolean =>
        mountedRef.current &&
        openRef.current &&
        compositionRef.current === owner &&
        sessionGenerationRef.current === session &&
        sourceGenerationRef.current === selectionGeneration &&
        !authorityConsumed();
      if (!isCurrent()) return;

      let selected: unknown;
      try {
        selected = await owner.selectors.selectSourceRepository();
      } catch {
        await revokeSafely(owner);
        clearGrantMemory();
        clearRenderedGrants();
        if (isCurrent()) setViewState({ kind: "refused", code: "source-grant-invalid" });
        return;
      }

      if (!isCurrent()) {
        await revokeSafely(owner);
        clearGrantMemory();
        clearRenderedGrants();
        return;
      }

      const grant = snapshotSourceGrant(selected);
      if (!grant) {
        await revokeSafely(owner);
        clearGrantMemory();
        clearRenderedGrants();
        setViewState({ kind: "refused", code: "source-grant-invalid" });
        return;
      }
      sourceGrantRef.current = grant;
      flushSync(() => setSourceRepository(grant.repository));
    });
  }, [
    authorityConsumed,
    clearGrantMemory,
    clearRenderedGrants,
    enqueueAuthority,
    invalidateReadyApproval,
    revokeSafely,
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
    previewGenerationRef.current += 1;
    const retainedReadyPreview = invalidateReadyApproval();
    if (!retainedReadyPreview) setViewState(EDITING);

    await enqueueAuthority(async () => {
      const isCurrent = (): boolean =>
        mountedRef.current &&
        openRef.current &&
        compositionRef.current === owner &&
        sessionGenerationRef.current === session &&
        destinationGenerationRef.current === selectionGeneration &&
        !authorityConsumed();
      if (!isCurrent()) return;

      let selected: unknown;
      try {
        selected = await owner.selectors.selectDestinationParent(modIdRef.current);
      } catch {
        await revokeSafely(owner);
        clearGrantMemory();
        clearRenderedGrants();
        if (isCurrent()) {
          setViewState({ kind: "refused", code: "destination-parent-grant-invalid" });
        }
        return;
      }

      if (!isCurrent()) {
        await revokeSafely(owner);
        clearGrantMemory();
        clearRenderedGrants();
        return;
      }

      const selection = snapshotDestinationSelection(selected);
      if (!selection) {
        await revokeSafely(owner);
        clearGrantMemory();
        clearRenderedGrants();
        setViewState({ kind: "refused", code: "destination-parent-grant-invalid" });
        return;
      }
      destinationSelectionRef.current = selection;
      flushSync(() => {
        setDestinationParent(selection.destinationParentGrant.parent);
        setFinalProjectLocation(selection.operationGrant.derivedDestination);
      });
    });
  }, [
    authorityConsumed,
    clearGrantMemory,
    clearRenderedGrants,
    enqueueAuthority,
    invalidateReadyApproval,
    revokeSafely,
  ]);

  const setModId = useCallback(
    (nextModId: string): void => {
      if (authorityConsumed()) return;
      modIdRef.current = nextModId;
      previewGenerationRef.current += 1;
      const retainedReadyPreview = invalidateReadyApproval();
      setModIdState(nextModId);
      if (!retainedReadyPreview) setViewState(EDITING);
    },
    [authorityConsumed, invalidateReadyApproval],
  );

  const preview = useCallback(
    async (exactModId: string): Promise<void> => {
      if (!openRef.current || authorityConsumed()) return;
      modIdRef.current = exactModId;
      setModIdState(exactModId);
      invalidateReadyApproval();

      const validation = validateXcom2ProjectFoundryModId(exactModId);
      if (validation.kind === "refused") {
        previewGenerationRef.current += 1;
        setViewState(validation);
        return;
      }

      const owner = compositionRef.current;
      const sourceGrant = sourceGrantRef.current;
      const destinationSelection = destinationSelectionRef.current;
      if (!owner || !sourceGrant) {
        setViewState({ kind: "refused", code: "source-grant-invalid" });
        return;
      }
      if (!destinationSelection) {
        setViewState({ kind: "refused", code: "destination-parent-grant-invalid" });
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
        !authorityConsumed();
      if (viewState.kind !== "ready") setViewState({ kind: "busy" });

      await enqueueAuthority(async () => {
        if (!current()) return;
        let sourceObject: Readonly<Xcom2ProjectFoundrySourceObjectEvidence> | null;
        try {
          sourceObject = snapshotSourceEvidence(
            await owner.source.resolvePinnedObject(sourceGrant),
          );
        } catch {
          if (current()) setViewState({ kind: "refused", code: "source-commit-unreadable" });
          return;
        }
        if (!current()) return;
        if (!sourceObject) {
          setViewState({ kind: "refused", code: "source-commit-unreadable" });
          return;
        }

        let destinationState: Xcom2ProjectFoundryDestinationState;
        try {
          destinationState = await owner.destination.inspectDerivedDestination(
            destinationSelection.destinationParentGrant,
            destinationSelection.operationGrant,
          );
        } catch {
          if (current()) {
            setViewState({ kind: "refused", code: "destination-parent-unavailable" });
          }
          return;
        }
        if (!current()) return;

        try {
          const request = createXcom2ProjectFoundryPreviewRequest({
            sourceGrant,
            destinationParentGrant: destinationSelection.destinationParentGrant,
            operationGrant: destinationSelection.operationGrant,
            sourceObject,
            destinationState,
            modId: exactModId,
          });
          if (!current()) return;
          const result = previewXcom2ProjectFoundry(request);
          if (result.kind === "ready") {
            const currentSelection: Xcom2ProjectFoundryApplyCurrentSelection = {
              sourceGrant,
              destinationParentGrant: destinationSelection.destinationParentGrant,
              operationGrant: destinationSelection.operationGrant,
              modId: exactModId,
            };
            const readyApplyState = createXcom2ProjectFoundryReadyApplyState({
              preview: result,
              current: currentSelection,
            });
            applyStateRef.current = readyApplyState;
            setApplyState(readyApplyState);
            setCreationState(
              typeof owner.apply === "function" ? { kind: "ready" } : CREATION_UNAVAILABLE,
            );
          }
          setViewState(result);
        } catch {
          if (current()) setViewState({ kind: "refused", code: "operation-grant-invalid" });
        }
      });
    },
    [authorityConsumed, enqueueAuthority, invalidateReadyApproval, viewState.kind],
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
            ({ result: "created" } as unknown as Xcom2ProjectFoundryApplyResult);
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
        applyStateRef.current = completion.state;
        clearGrantMemory();
        if (mountedRef.current) {
          setApplyState(completion.state);
          if (completion.kind === "transitioned" && completion.state.status === "created") {
            setCreationState({ kind: "created", receipt: completion.state.receipt });
          } else {
            setCreationState({ kind: "consumed" });
          }
        }
        await revokeSafely(owner);
      });
    },
    [clearGrantMemory, enqueueAuthority, revokeSafely],
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
    await enqueueAuthority(() => revokeSafely(owner));
  }, [clearAuthorityMemory, clearRenderedMemory, enqueueAuthority, invalidateAll, revokeSafely]);

  useEffect(() => {
    const previous = previousCompositionRef.current;
    if (previous === composition) return;
    previousCompositionRef.current = composition;
    invalidateAll();
    openRef.current = false;
    clearAuthorityMemory();
    setIsOpen(false);
    clearRenderedMemory();
    void enqueueAuthority(() => revokeSafely(previous));
  }, [
    clearAuthorityMemory,
    clearRenderedMemory,
    composition,
    enqueueAuthority,
    invalidateAll,
    revokeSafely,
  ]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const owner = compositionRef.current;
      invalidateAll();
      openRef.current = false;
      clearAuthorityMemory();
      void enqueueAuthority(() => revokeSafely(owner));
    };
  }, [clearAuthorityMemory, enqueueAuthority, invalidateAll, revokeSafely]);

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
