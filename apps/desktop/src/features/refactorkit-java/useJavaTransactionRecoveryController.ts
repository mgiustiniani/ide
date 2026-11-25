import { useCallback, useEffect, useRef, useState } from "react";
import {
  captureJavaProjectOperationContext,
  javaEditorRecoveryOffered,
  sameJavaProjectContextSettings,
  type JavaEffectiveProjectContext,
  type JavaEditorTransaction,
  type JavaProjectContextSettings,
} from "@ide/contracts";
import {
  reviewJavaEditorRecovery,
  restoreJavaEditorRecovery,
  JavaEditorTransactionError,
  type EditorViewModel,
  type JavaEditorRecoveryReview,
  type JavaEditorRefactoringOutcome,
  type RefactorKitPort,
} from "@ide/web-core";
import type { RefactorKitCapabilities } from "@ide/contracts";

interface Dependencies {
  workspaceId: string | null;
  generation: number;
  port: RefactorKitPort;
  editor: Pick<
    EditorViewModel,
    "captureEditorBuffers" | "beginEditorTransaction" | "openFile" | "inspectSourceRevision"
  >;
  capabilities: RefactorKitCapabilities | null;
  getWorkspaceContext(): {
    workspaceId: string | null;
    generation: number;
    isSwitching: boolean;
    isMetadataLoading?: boolean;
  };
  getProjectContext(): {
    settings: JavaProjectContextSettings;
    context: JavaEffectiveProjectContext | null;
  };
  isOtherWriting: boolean;
  onSourceChanged(): void;
  reconcile(
    changes: JavaEditorRefactoringOutcome["changes"],
    isCurrent: () => boolean,
  ): Promise<string | undefined>;
}
export interface JavaTransactionRecoveryState {
  phase: "loading" | "ready" | "reviewing" | "review" | "restoring" | "restored" | "error";
  entries: JavaEditorTransaction[];
  review: JavaEditorRecoveryReview | null;
  message?: string;
}

export function useJavaTransactionRecoveryController(dependencies: Dependencies) {
  const latest = useRef(dependencies);
  latest.current = dependencies;
  const [state, setState] = useState<JavaTransactionRecoveryState | null>(null);
  const [isWriting, setWriting] = useState(false);
  const currentState = useRef(state);
  const observedCapabilities = useRef<{
    workspaceId: string;
    generation: number;
    capabilities: RefactorKitCapabilities;
  } | null>(null);
  currentState.current = state;
  const sequence = useRef(0),
    busy = useRef(false),
    writing = useRef(false);
  const authorize = useCallback(() => {
    const d = latest.current,
      workspace = d.getWorkspaceContext(),
      selected = d.getProjectContext();
    const capabilities =
      d.capabilities ??
      (observedCapabilities.current?.workspaceId === workspace.workspaceId &&
      observedCapabilities.current.generation === workspace.generation
        ? observedCapabilities.current.capabilities
        : null);
    if (d.isOtherWriting || !javaEditorRecoveryOffered(capabilities) || !d.port.editorTransaction)
      throw new Error(
        "Durable Java draft recovery is unavailable or another refactoring is running.",
      );
    if (!workspace.workspaceId || workspace.isSwitching || workspace.isMetadataLoading)
      throw new Error("Wait for the current workspace to finish opening.");
    const projectContext = captureJavaProjectOperationContext(selected);
    if (!projectContext)
      throw new Error(
        "Select a project JDK and synchronize the Java project before loading transactions.",
      );
    const token = sequence.current;
    const isCurrent = () => {
      const context = latest.current.getWorkspaceContext();
      return (
        context.workspaceId === workspace.workspaceId &&
        context.generation === workspace.generation &&
        !context.isSwitching
      );
    };
    const assertCurrent = () => {
      if (
        token !== sequence.current ||
        !isCurrent() ||
        !sameJavaProjectContextSettings(
          projectContext,
          latest.current.getProjectContext().settings,
        ) ||
        !javaEditorRecoveryOffered(latest.current.capabilities ?? capabilities)
      )
        throw new Error(
          "The workspace, selected SDK or recovery review changed. Synchronize and review again.",
        );
    };
    return {
      d,
      workspace: { workspaceId: workspace.workspaceId, generation: workspace.generation },
      selected,
      projectContext,
      assertCurrent,
      isCurrent,
      token,
    };
  }, []);
  const refresh = useCallback(async () => {
    if (busy.current || latest.current.isOtherWriting) return;
    sequence.current++;
    busy.current = true;
    const token = sequence.current;
    setState({ phase: "loading", entries: [], review: null });
    try {
      const workspace = latest.current.getWorkspaceContext();
      if (!latest.current.capabilities && workspace.workspaceId) {
        const capabilities = await latest.current.port.getCapabilities();
        const actual = latest.current.getWorkspaceContext();
        if (
          token !== sequence.current ||
          actual.workspaceId !== workspace.workspaceId ||
          actual.generation !== workspace.generation
        )
          return;
        observedCapabilities.current = {
          workspaceId: workspace.workspaceId,
          generation: workspace.generation,
          capabilities,
        };
      }
      const a = authorize();
      const result = await a.d.port.editorTransaction!({
        ...a.workspace,
        phase: "transactions",
        projectContext: a.projectContext,
        documents: [],
      });
      a.assertCurrent();
      if (result.kind !== "discovery")
        throw new Error("The provider did not return a Java transaction inventory.");
      setState({ phase: "ready", entries: result.transactions, review: null });
    } catch (error) {
      if (token === sequence.current)
        setState({
          phase: "error",
          entries: [],
          review: null,
          message:
            error instanceof Error ? error.message : "Java transactions could not be loaded.",
        });
    } finally {
      busy.current = false;
    }
  }, [authorize]);
  const review = useCallback(
    async (entry: JavaEditorTransaction) => {
      const previous = currentState.current;
      if (busy.current || !previous?.entries.includes(entry)) return;
      sequence.current++;
      busy.current = true;
      const token = sequence.current;
      setState({ ...previous, phase: "reviewing", review: null, message: undefined });
      try {
        const a = authorize();
        if (!a.selected.context?.sdk.some((sdk) => sdk.home === entry.sdkHome))
          throw new Error(
            "Select the original transaction JDK and synchronize the project before recovery.",
          );
        if (entry.status === "undone" || entry.status === "aborted")
          throw new Error("This transaction is already restored.");
        const result = await reviewJavaEditorRecovery({
          transaction: entry,
          projectContext: a.projectContext,
          ...a.workspace,
          editor: a.d.editor,
          port: a.d.port,
          assertCurrent: a.assertCurrent,
        });
        a.assertCurrent();
        if ("alreadyRestored" in result)
          setState({
            ...previous,
            phase: "restored",
            review: null,
            entries: previous.entries.map((e) =>
              e === entry ? { ...e, status: result.transaction.status } : e,
            ),
            message:
              "The original drafts and saved paths are already restored. No source content was written.",
          });
        else setState({ ...previous, phase: "review", review: result });
      } catch (error) {
        if (token === sequence.current)
          setState({
            ...previous,
            phase: "error",
            review: null,
            message:
              error instanceof Error
                ? error.message
                : "Recovery could not be reviewed. Current drafts were retained.",
          });
      } finally {
        busy.current = false;
      }
    },
    [authorize],
  );
  const restore = useCallback(async () => {
    const previous = currentState.current,
      reviewed = previous?.review;
    if (busy.current || !reviewed || previous?.phase !== "review") return;
    busy.current = true;
    writing.current = true;
    setWriting(true);
    setState({ ...previous, phase: "restoring", message: undefined });
    const token = sequence.current;
    const binding = reviewed.authority;
    const isCurrent = () => {
      const w = latest.current.getWorkspaceContext();
      return (
        w.workspaceId === binding.workspaceId &&
        w.generation === binding.generation &&
        !w.isSwitching
      );
    };
    const assertCurrent = () => {
      reviewed.verify();
      if (token !== sequence.current || !isCurrent())
        throw new Error("The recovery workspace changed.");
    };
    // Buffer review verification is required before alignment, not after our own committed edits.
    const assertAuthority = () => {
      if (
        token !== sequence.current ||
        !isCurrent() ||
        latest.current.isOtherWriting ||
        !sameJavaProjectContextSettings(
          binding.projectContext,
          latest.current.getProjectContext().settings,
        ) ||
        !javaEditorRecoveryOffered(
          latest.current.capabilities ?? observedCapabilities.current?.capabilities ?? null,
        )
      )
        throw new Error("The selected SDK or workspace changed during recovery.");
    };
    try {
      assertCurrent();
      assertAuthority();
      const outcome = await restoreJavaEditorRecovery({
        review: reviewed,
        editor: latest.current.editor,
        port: latest.current.port,
        assertCurrent: assertAuthority,
      });
      if (outcome.transaction.status !== "undone")
        throw new Error(
          "The original drafts have no confirmed recovery outcome. Review the durable transaction again.",
        );
      if (outcome.changes.some((c) => c.oldPath !== c.path)) latest.current.onSourceChanged();
      let warning: string | undefined;
      try {
        warning = await latest.current.reconcile(outcome.changes, isCurrent);
      } catch {
        warning = "Some views could not be refreshed. Reactivate the recovered tabs.";
      }
      if (token === sequence.current && isCurrent())
        setState({
          ...previous,
          phase: "restored",
          review: null,
          entries: previous.entries.map((e) =>
            e.transactionId === outcome.transaction.transactionId ? { ...e, status: "undone" } : e,
          ),
          message: `Original Java drafts restored without saving source content.${warning ? ` ${warning}` : ""}`,
        });
    } catch (error) {
      if (isCurrent()) {
        if (reviewed.workspaceEdit.documentChanges.some((c) => c.kind === "rename"))
          latest.current.onSourceChanged();
        if (error instanceof JavaEditorTransactionError && error.buffersCommitted) {
          try {
            await latest.current.reconcile(error.changes, isCurrent);
          } catch {
            /* Preserve the unconfirmed transaction outcome. */
          }
        }
      }
      if (token === sequence.current && isCurrent())
        setState({
          ...previous,
          phase: "error",
          review: null,
          message: `${error instanceof Error ? error.message : "Restoration failed."} Current drafts were retained. Refresh transactions and review recovery again.`,
        });
    } finally {
      busy.current = false;
      writing.current = false;
      setWriting(false);
    }
  }, []);
  const close = useCallback(() => {
    if (writing.current) return;
    sequence.current++;
    setState(null);
  }, []);
  const resetWorkspace = useCallback(() => {
    sequence.current++;
    setState(null);
  }, []);
  useEffect(
    () => () => {
      sequence.current++;
    },
    [],
  );
  useEffect(() => {
    sequence.current++;
    observedCapabilities.current = null;
    setState(null);
  }, [dependencies.workspaceId, dependencies.generation]);
  return { state, isWriting, refresh, review, restore, close, resetWorkspace };
}
