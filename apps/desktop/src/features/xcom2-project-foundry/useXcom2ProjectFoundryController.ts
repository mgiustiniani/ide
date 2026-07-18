import type {
  Xcom2ProjectFoundryDestinationParentSelectionGrant,
  Xcom2ProjectFoundryDestinationState,
  Xcom2ProjectFoundryOperationGrant,
  Xcom2ProjectFoundrySourceObjectEvidence,
  Xcom2ProjectFoundrySourceSelectionGrant,
} from "@ide/contracts";
import type { Xcom2ProjectFoundryDialogViewState } from "@ide/ui";
import {
  createXcom2ProjectFoundryPreviewRequest,
  previewXcom2ProjectFoundry,
  validateXcom2ProjectFoundryModId,
} from "@ide/web-core";
import { useCallback, useEffect, useRef, useState } from "react";

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
  readonly grants: {
    revokeAll(): Promise<void>;
  };
}

export interface Xcom2ProjectFoundryController {
  readonly isOpen: boolean;
  readonly sourceRepository: string;
  readonly destinationParent: string;
  readonly modId: string;
  readonly viewState: Xcom2ProjectFoundryDialogViewState;
  open(): void;
  selectSourceRepository(): Promise<void>;
  selectDestinationParent(): Promise<void>;
  setModId(modId: string): void;
  preview(modId: string): Promise<void>;
  cancel(): Promise<void>;
}

const EDITING = Object.freeze({ kind: "editing" } as const);

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

/**
 * Provider-neutral desktop orchestration for the display-only Project Foundry preview.
 * Authority is injected, serialized, generation-checked, and always discarded explicitly.
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

  const [isOpen, setIsOpen] = useState(false);
  const [sourceRepository, setSourceRepository] = useState("");
  const [destinationParent, setDestinationParent] = useState("");
  const [modId, setModIdState] = useState("");
  const [viewState, setViewState] = useState<Xcom2ProjectFoundryDialogViewState>(EDITING);

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
  }, []);

  const clearAuthorityMemory = useCallback((): void => {
    clearGrantMemory();
    modIdRef.current = "";
  }, [clearGrantMemory]);

  const clearRenderedMemory = useCallback((): void => {
    clearRenderedGrants();
    setModIdState("");
    setViewState(EDITING);
  }, [clearRenderedGrants]);

  const invalidateAll = useCallback((): number => {
    const generation = ++sessionGenerationRef.current;
    sourceGenerationRef.current += 1;
    destinationGenerationRef.current += 1;
    previewGenerationRef.current += 1;
    return generation;
  }, []);

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
    if (!owner || !openRef.current) {
      if (openRef.current) setViewState({ kind: "refused", code: "source-grant-invalid" });
      return;
    }
    const session = sessionGenerationRef.current;
    const selectionGeneration = ++sourceGenerationRef.current;
    const replacesExistingGrant = sourceGrantRef.current !== null;
    previewGenerationRef.current += 1;
    setViewState(EDITING);

    await enqueueAuthority(async () => {
      const isCurrent = (): boolean =>
        mountedRef.current &&
        openRef.current &&
        compositionRef.current === owner &&
        sessionGenerationRef.current === session &&
        sourceGenerationRef.current === selectionGeneration;
      if (!isCurrent()) return;
      if (replacesExistingGrant) {
        await revokeSafely(owner);
        clearGrantMemory();
        clearRenderedGrants();
        if (!isCurrent()) return;
      }

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
      setSourceRepository(grant.repository);
    });
  }, [clearGrantMemory, clearRenderedGrants, enqueueAuthority, revokeSafely]);

  const selectDestinationParent = useCallback(async (): Promise<void> => {
    const owner = compositionRef.current;
    if (!owner || !openRef.current) {
      if (openRef.current) {
        setViewState({ kind: "refused", code: "destination-parent-grant-invalid" });
      }
      return;
    }
    const session = sessionGenerationRef.current;
    const selectionGeneration = ++destinationGenerationRef.current;
    const replacesExistingGrant = destinationSelectionRef.current !== null;
    previewGenerationRef.current += 1;
    setViewState(EDITING);

    await enqueueAuthority(async () => {
      const isCurrent = (): boolean =>
        mountedRef.current &&
        openRef.current &&
        compositionRef.current === owner &&
        sessionGenerationRef.current === session &&
        destinationGenerationRef.current === selectionGeneration;
      if (!isCurrent()) return;
      if (replacesExistingGrant) {
        await revokeSafely(owner);
        clearGrantMemory();
        clearRenderedGrants();
        if (!isCurrent()) return;
      }

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
      setDestinationParent(selection.destinationParentGrant.parent);
    });
  }, [clearGrantMemory, clearRenderedGrants, enqueueAuthority, revokeSafely]);

  const setModId = useCallback((nextModId: string): void => {
    modIdRef.current = nextModId;
    previewGenerationRef.current += 1;
    setModIdState(nextModId);
    setViewState(EDITING);
  }, []);

  const preview = useCallback(
    async (exactModId: string): Promise<void> => {
      if (!openRef.current) return;
      modIdRef.current = exactModId;
      setModIdState(exactModId);

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
        previewGenerationRef.current === previewGeneration;
      setViewState({ kind: "busy" });

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
          setViewState(previewXcom2ProjectFoundry(request));
        } catch {
          if (current()) setViewState({ kind: "refused", code: "operation-grant-invalid" });
        }
      });
    },
    [enqueueAuthority],
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
    viewState,
    open,
    selectSourceRepository,
    selectDestinationParent,
    setModId,
    preview,
    cancel,
  };
}
