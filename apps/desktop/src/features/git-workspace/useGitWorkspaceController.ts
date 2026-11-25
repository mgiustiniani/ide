import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  GitWorkspaceBlame,
  GitWorkspaceBranchDeletePlan,
  GitWorkspaceHistory,
  GitWorkspaceCommitReview,
  GitWorkspaceRebasePlan,
  GitWorkspaceMutationRequest,
  GitWorkspaceReview,
  GitWorkspaceSnapshot,
  WorkspaceInfo,
} from "@ide/contracts";
import type { GitWorkspacePort } from "@ide/web-core/ports";
import { isNormalizedWorkspaceRelativePath } from "@ide/web-core/editor-open-coordinator";
interface Dependencies {
  port: GitWorkspacePort | undefined;
  workspace: WorkspaceInfo | null;
  generation: number;
  activeFilePath?: string | null;
  getContext(): {
    workspaceId: string | null;
    generation: number;
    isSwitching: boolean;
    isMetadataLoading: boolean;
  };
  isDirty(path: string): boolean;
  canMutate(): boolean;
  openFile(path: string): Promise<boolean>;
  openBlameLocation?(
    path: string,
    line: number,
    fingerprint: string,
    isCurrent: () => boolean,
  ): Promise<boolean>;
  onTransitionBlockReason(reason: string | null): void;
  beginBranchSwitch(): {
    reconcile(isCurrent: () => boolean): Promise<string | undefined>;
    release(): void;
  };
}
const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message.replace(/^\[tauri:[^\]]+\]\s*/, "")
    : "Git is unavailable. Refresh before retrying.";
const BLOCK =
  "Wait for the Git operation to finish before switching workspaces or closing the IDE.";

/** Local Git state and explicit user actions, scoped to one workspace activation. */
export function useGitWorkspaceController(dependencies: Dependencies) {
  const latest = useRef(dependencies);
  latest.current = dependencies;
  const scope = useMemo(
    () => ({
      workspaceId: dependencies.workspace?.id ?? null,
      root: dependencies.workspace?.rootPath ?? null,
      generation: dependencies.generation,
      trusted: false,
      snapshot: null as GitWorkspaceSnapshot | null,
      review: null as GitWorkspaceReview | null,
      blame: null as GitWorkspaceBlame | null,
      history: null as GitWorkspaceHistory | null,
      commitReview: null as GitWorkspaceCommitReview | null,
      rebasePlan: null as GitWorkspaceRebasePlan | null,
      deletePlan: null as GitWorkspaceBranchDeletePlan | null,
      error: null as string | null,
      status: null as string | null,
      busy: null as string | null,
      message: "",
      authorName: "",
      authorEmail: "",
      identityInitialized: false,
    }),
    [
      dependencies.workspace?.id,
      dependencies.workspace?.rootPath,
      dependencies.generation,
      dependencies.port,
    ],
  );
  const liveScope = useRef(scope);
  liveScope.current = scope;
  const alive = useRef(true),
    sequence = useRef(0),
    writing = useRef(false);
  const [, setRevision] = useState(0);
  const update = useCallback(() => {
    if (alive.current) setRevision((value) => value + 1);
  }, []);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      sequence.current++;
    };
  }, []);
  const current = useCallback((owner: typeof scope) => {
    const context = latest.current.getContext();
    return (
      alive.current &&
      Boolean(latest.current.port) &&
      liveScope.current === owner &&
      owner.workspaceId !== null &&
      owner.root !== null &&
      context.workspaceId === owner.workspaceId &&
      context.generation === owner.generation &&
      !context.isSwitching &&
      !context.isMetadataLoading
    );
  }, []);
  const setTrusted = useCallback(
    (trusted: boolean) => {
      if (!current(scope) || writing.current) return;
      sequence.current++;
      scope.trusted = trusted;
      scope.snapshot = null;
      scope.review = null;
      scope.blame = null;
      scope.rebasePlan = null;
      scope.deletePlan = null;
      scope.busy = null;
      scope.error = null;
      scope.status = null;
      update();
    },
    [scope, current, update],
  );
  const accept = useCallback(
    (snapshot: GitWorkspaceSnapshot) => {
      scope.snapshot = snapshot;
      scope.history = null;
      scope.commitReview = null;
      scope.review = null;
      scope.blame = null;
      scope.rebasePlan = null;
      scope.deletePlan = null;
      if (!scope.identityInitialized) {
        scope.authorName = snapshot.authorName;
        scope.authorEmail = snapshot.authorEmail;
        scope.identityInitialized = true;
      }
    },
    [scope],
  );
  const refresh = useCallback(async () => {
    if (!current(scope) || !scope.trusted || writing.current || scope.busy) return false;
    const request = ++sequence.current;
    scope.busy = "Refreshing Git…";
    scope.snapshot = null;
    scope.review = null;
    scope.blame = null;
    scope.rebasePlan = null;
    scope.error = null;
    scope.status = null;
    update();
    try {
      const snapshot = await latest.current.port!.inspect({
        workspacePath: scope.root!,
        trusted: true,
      });
      if (!current(scope) || sequence.current !== request || !scope.trusted) return false;
      accept(snapshot);
      return true;
    } catch (error) {
      if (current(scope) && sequence.current === request) scope.error = errorMessage(error);
      return false;
    } finally {
      if (liveScope.current === scope && sequence.current === request) {
        scope.busy = null;
        update();
      }
    }
  }, [scope, current, update, accept]);
  const review = useCallback(
    async (path: string | null, staged: boolean) => {
      const snapshot = scope.snapshot;
      if (!current(scope) || !scope.trusted || !snapshot || scope.busy || writing.current)
        return false;
      const request = ++sequence.current;
      scope.busy = "Reviewing Git changes…";
      scope.review = null;
      scope.blame = null;
      scope.rebasePlan = null;
      scope.deletePlan = null;
      scope.error = null;
      scope.status = null;
      update();
      try {
        const response = await latest.current.port!.review({
          workspacePath: scope.root!,
          trusted: true,
          activation: snapshot.activation,
          revision: snapshot.revision,
          path,
          staged,
        });
        if (
          !current(scope) ||
          sequence.current !== request ||
          scope.snapshot !== snapshot ||
          !scope.trusted
        )
          return false;
        if (
          response.revision !== snapshot.revision ||
          response.path !== path ||
          response.staged !== staged
        )
          throw new Error("The Git review does not match the selected changes. Refresh Git.");
        scope.review = response;
        return true;
      } catch (error) {
        if (current(scope) && sequence.current === request) {
          scope.error = errorMessage(error);
          scope.snapshot = null;
        }
        return false;
      } finally {
        if (liveScope.current === scope && sequence.current === request) {
          scope.busy = null;
          update();
        }
      }
    },
    [scope, current, update],
  );
  const loadHistory = useCallback(
    async (path: string | null = null, offset = 0) => {
      const snapshot = scope.snapshot,
        port = latest.current.port;
      if (
        !current(scope) ||
        !scope.trusted ||
        !snapshot?.head ||
        !port?.history ||
        scope.busy ||
        writing.current
      )
        return false;
      if (
        (path !== null && (!isNormalizedWorkspaceRelativePath(path) || path.length > 32768)) ||
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        offset % 50 !== 0 ||
        offset > 4294967245
      ) {
        scope.error = "Choose a workspace-relative history path and a valid page.";
        update();
        return false;
      }
      // Paging continues only the currently captured HEAD and literal path selection.
      if (
        offset !== 0 &&
        (!scope.history ||
          scope.history.head !== snapshot.head ||
          scope.history.path !== path ||
          (offset !== scope.history.nextOffset &&
            offset !== Math.max(0, scope.history.offset - 50)))
      )
        return false;
      const request = ++sequence.current;
      scope.busy = "Reading Git history…";
      scope.commitReview = null;
      scope.error = null;
      scope.status = null;
      update();
      try {
        const response = await port.history({
          workspacePath: scope.root!,
          trusted: true,
          activation: snapshot.activation,
          revision: snapshot.revision,
          head: snapshot.head,
          path,
          offset,
        });
        if (
          !current(scope) ||
          sequence.current !== request ||
          scope.snapshot !== snapshot ||
          latest.current.port !== port ||
          !scope.trusted
        )
          return false;
        if (
          response.activation !== snapshot.activation ||
          response.revision !== snapshot.revision ||
          response.head !== snapshot.head ||
          response.path !== path ||
          response.offset !== offset ||
          response.commits.length > 50 ||
          (response.nextOffset !== null &&
            (response.nextOffset !== offset + 50 || response.commits.length !== 50))
        )
          throw new Error("The Git history does not match the captured page. Refresh Git.");
        scope.history = response;
        return true;
      } catch (error) {
        if (current(scope) && sequence.current === request) {
          scope.error = errorMessage(error);
          scope.history = null;
          scope.snapshot = null;
        }
        return false;
      } finally {
        if (liveScope.current === scope && sequence.current === request) {
          scope.busy = null;
          update();
        }
      }
    },
    [scope, current, update],
  );
  const reviewCommit = useCallback(
    async (commit: string) => {
      const snapshot = scope.snapshot,
        page = scope.history,
        port = latest.current.port;
      if (
        !current(scope) ||
        !scope.trusted ||
        !snapshot?.head ||
        !page ||
        !port?.commitReview ||
        scope.busy ||
        writing.current ||
        !page.commits.some((value) => value.id === commit)
      )
        return false;
      const request = ++sequence.current;
      scope.busy = "Reading committed changes…";
      scope.commitReview = null;
      scope.error = null;
      scope.status = null;
      update();
      try {
        const response = await port.commitReview({
          workspacePath: scope.root!,
          trusted: true,
          activation: snapshot.activation,
          revision: snapshot.revision,
          head: page.head,
          path: page.path,
          offset: page.offset,
          commit,
        });
        if (
          !current(scope) ||
          sequence.current !== request ||
          scope.snapshot !== snapshot ||
          scope.history !== page ||
          latest.current.port !== port ||
          !scope.trusted
        )
          return false;
        if (
          response.activation !== snapshot.activation ||
          response.revision !== snapshot.revision ||
          response.head !== page.head ||
          response.path !== page.path ||
          response.offset !== page.offset ||
          response.commit !== commit
        )
          throw new Error("The commit review does not match the captured history. Refresh Git.");
        scope.commitReview = response;
        return true;
      } catch (error) {
        if (current(scope) && sequence.current === request) {
          scope.error = errorMessage(error);
          scope.history = null;
          scope.snapshot = null;
        }
        return false;
      } finally {
        if (liveScope.current === scope && sequence.current === request) {
          scope.busy = null;
          update();
        }
      }
    },
    [scope, current, update],
  );
  const blameFile = useCallback(
    async (path: string, startLine = 1, savedFingerprint?: string) => {
      const snapshot = scope.snapshot,
        port = dependencies.port;
      if (
        !current(scope) ||
        latest.current.port !== port ||
        !port?.blame ||
        !scope.trusted ||
        !snapshot?.head ||
        scope.busy ||
        writing.current
      )
        return false;
      if (
        !isNormalizedWorkspaceRelativePath(path) ||
        path.length > 32768 ||
        !Number.isSafeInteger(startLine) ||
        startLine < 1
      ) {
        scope.error = "Choose a workspace-relative file path and a positive saved line number.";
        update();
        return false;
      }
      const request = ++sequence.current;
      scope.busy = "Reading saved-source blame…";
      scope.review = null;
      scope.blame = null;
      scope.rebasePlan = null;
      scope.deletePlan = null;
      scope.error = null;
      scope.status = null;
      update();
      try {
        const response = await port.blame({
          workspacePath: scope.root!,
          trusted: true,
          activation: snapshot.activation,
          revision: snapshot.revision,
          path,
          startLine,
          ...(savedFingerprint ? { savedFingerprint } : {}),
        });
        if (
          !current(scope) ||
          latest.current.port !== port ||
          sequence.current !== request ||
          scope.snapshot !== snapshot
        )
          return false;
        if (
          response.activation !== snapshot.activation ||
          response.revision !== snapshot.revision ||
          response.path !== path ||
          response.startLine !== startLine ||
          !/^[a-f0-9]{64}$/u.test(response.savedFingerprint) ||
          (savedFingerprint !== undefined && response.savedFingerprint !== savedFingerprint)
        )
          throw new Error("The blame page does not match its saved-source request. Refresh Git.");
        scope.blame = response;
        return true;
      } catch (error) {
        if (current(scope) && sequence.current === request) {
          scope.blame = null;
          scope.rebasePlan = null;
          scope.deletePlan = null;
          scope.snapshot = null;
          scope.error = errorMessage(error);
        }
        return false;
      } finally {
        if (liveScope.current === scope && sequence.current === request) {
          scope.busy = null;
          update();
        }
      }
    },
    [scope, dependencies.port, current, update],
  );
  const openBlameLine = useCallback(
    async (line: number): Promise<boolean> => {
      const page = scope.blame,
        snapshot = scope.snapshot,
        port = dependencies.port;
      const navigate = latest.current.openBlameLocation;
      if (
        !current(scope) ||
        latest.current.port !== port ||
        !port?.blame ||
        !navigate ||
        !scope.trusted ||
        !snapshot?.head ||
        !page ||
        scope.busy ||
        writing.current ||
        !Number.isSafeInteger(line) ||
        !page.lines.some((entry) => entry.line === line)
      )
        return false;
      if (latest.current.isDirty(page.path)) {
        scope.error = "Save or discard this file's draft before opening a saved blame line.";
        update();
        return false;
      }
      const request = ++sequence.current;
      const isCurrent = () =>
        current(scope) &&
        latest.current.port === port &&
        sequence.current === request &&
        scope.snapshot === snapshot &&
        scope.blame === page &&
        !latest.current.isDirty(page.path);
      scope.busy = "Opening saved blame line…";
      scope.error = null;
      update();
      try {
        const response = await port.blame({
          workspacePath: scope.root!,
          trusted: true,
          activation: snapshot.activation,
          revision: snapshot.revision,
          path: page.path,
          startLine: page.startLine,
          savedFingerprint: page.savedFingerprint,
        });
        if (!isCurrent()) return false;
        if (
          response.activation !== page.activation ||
          response.revision !== page.revision ||
          response.path !== page.path ||
          response.startLine !== page.startLine ||
          response.savedFingerprint !== page.savedFingerprint ||
          !response.lines.some((entry) => entry.line === line)
        )
          throw new Error("The saved blame source changed. Refresh Git and request blame again.");
        const opened = await navigate(page.path, line, page.savedFingerprint, isCurrent);
        if (!current(scope) || sequence.current !== request) return false;
        if (!opened) {
          scope.error =
            "The saved blame line could not be opened in its unchanged source. Refresh Git and request blame again.";
          update();
        }
        return opened && isCurrent();
      } catch (error) {
        if (current(scope) && sequence.current === request) {
          scope.snapshot = null;
          scope.blame = null;
          scope.error = errorMessage(error);
        }
        return false;
      } finally {
        if (liveScope.current === scope && sequence.current === request) {
          scope.busy = null;
          update();
        }
      }
    },
    [scope, dependencies.port, current, update],
  );
  const mutate = useCallback(
    async (action: GitWorkspaceMutationRequest) => {
      if (
        !current(scope) ||
        !scope.trusted ||
        scope.busy ||
        writing.current ||
        !latest.current.canMutate()
      )
        return false;
      const request = ++sequence.current;
      writing.current = true;
      const notify = latest.current.onTransitionBlockReason;
      notify(BLOCK);
      scope.busy = "Running Git operation…";
      scope.error = null;
      scope.status = null;
      scope.review = null;
      scope.blame = null;
      scope.rebasePlan = null;
      scope.deletePlan = null;
      update();
      let sourceWrite: ReturnType<Dependencies["beginBranchSwitch"]> | undefined;
      let warning: string | undefined;
      try {
        if (
          [
            "switchBranch",
            "mergeBranch",
            "abortMerge",
            "startRebase",
            "continueRebase",
            "skipRebase",
            "abortRebase",
          ].includes(action.kind)
        )
          sourceWrite = latest.current.beginBranchSwitch();
        let snapshot: GitWorkspaceSnapshot;
        try {
          snapshot = await latest.current.port!.mutate(action);
        } finally {
          if (sourceWrite && current(scope)) {
            try {
              warning = await sourceWrite.reconcile(() => current(scope));
            } catch {
              warning =
                "Some open files could not be synchronized. Compare them with disk before saving.";
            }
          }
        }
        if (!current(scope) || sequence.current !== request) return false;
        accept(snapshot);
        if (action.kind === "commit") scope.message = "";
        scope.status = [
          snapshot.rebase
            ? "Rebase paused. Review and stage saved resolutions, then continue, explicitly skip the stopped commit, or abort."
            : snapshot.mergeHeads?.length
              ? "Merge paused for review. Resolve saved conflicts, review the index and commit, or explicitly abort the merge."
              : "Git operation completed. Status refreshed.",
          warning,
        ]
          .filter(Boolean)
          .join(" ");
        return true;
      } catch (error) {
        if (current(scope) && sequence.current === request) {
          scope.snapshot = null;
          scope.error = [errorMessage(error), warning].filter(Boolean).join(" ");
        }
        return false;
      } finally {
        sourceWrite?.release();
        writing.current = false;
        notify(null);
        if (liveScope.current === scope && sequence.current === request) {
          scope.busy = null;
          update();
        }
      }
    },
    [scope, current, update, accept],
  );
  const prepareBranchDelete = useCallback(
    async (name: string) => {
      const snapshot = scope.snapshot,
        port = latest.current.port;
      if (
        !current(scope) ||
        !scope.trusted ||
        !snapshot?.head ||
        scope.busy ||
        writing.current ||
        !port?.branchDeletePlan ||
        snapshot.repositoryRoot !== scope.root ||
        name === snapshot.branch ||
        !snapshot.localBranches.some((branch) => branch.name === name)
      )
        return false;
      const request = ++sequence.current;
      scope.busy = "Reviewing local branch deletion…";
      scope.deletePlan = null;
      scope.error = null;
      scope.status = null;
      update();
      try {
        const value = await port.branchDeletePlan({
          workspacePath: scope.root!,
          trusted: true,
          activation: snapshot.activation,
          revision: snapshot.revision,
          name,
        });
        if (
          !current(scope) ||
          sequence.current !== request ||
          scope.snapshot !== snapshot ||
          latest.current.port !== port ||
          !scope.trusted
        )
          return false;
        if (
          value.activation !== snapshot.activation ||
          value.revision !== snapshot.revision ||
          value.name !== name ||
          value.branchHead !==
            snapshot.localBranches.find((branch) => branch.name === name)?.head ||
          value.currentHead !== snapshot.head ||
          !/^[a-f0-9]{64}$/u.test(value.fingerprint) ||
          !Number.isSafeInteger(value.commitsNotInHead) ||
          value.commitsNotInHead < 0 ||
          value.commits.length !== Math.min(200, value.commitsNotInHead) ||
          value.commitsTruncated !== value.commitsNotInHead > 200
        )
          throw new Error(
            "Branch deletion review does not match the selected branch. Refresh Git.",
          );
        scope.deletePlan = value;
        return true;
      } catch (error) {
        if (current(scope) && sequence.current === request) {
          scope.snapshot = null;
          scope.error = errorMessage(error);
        }
        return false;
      } finally {
        if (liveScope.current === scope && sequence.current === request) {
          scope.busy = null;
          update();
        }
      }
    },
    [scope, current, update],
  );
  const deleteReviewedBranch = useCallback(
    async (confirmation: string, force: boolean) => {
      const snapshot = scope.snapshot,
        plan = scope.deletePlan;
      if (
        !current(scope) ||
        !snapshot ||
        !plan ||
        plan.revision !== snapshot.revision ||
        plan.currentHead !== snapshot.head ||
        plan.branchHead !==
          snapshot.localBranches.find((branch) => branch.name === plan.name)?.head ||
        confirmation !== plan.name ||
        (plan.commitsNotInHead > 0 && !force)
      )
        return false;
      return mutate({
        workspacePath: scope.root!,
        trusted: true,
        activation: snapshot.activation,
        revision: snapshot.revision,
        kind: "deleteBranch",
        name: plan.name,
        planFingerprint: plan.fingerprint,
        confirmation,
        force,
      });
    },
    [scope, current, mutate],
  );
  const prepareRebase = useCallback(
    async (upstream: string) => {
      const snapshot = scope.snapshot,
        port = dependencies.port;
      if (
        !current(scope) ||
        !snapshot ||
        !scope.trusted ||
        scope.busy ||
        writing.current ||
        !port?.rebasePlan ||
        latest.current.port !== port
      )
        return false;
      const request = ++sequence.current;
      scope.busy = "Reading rebase history…";
      scope.review = null;
      scope.blame = null;
      scope.rebasePlan = null;
      scope.deletePlan = null;
      scope.error = null;
      update();
      try {
        const value = await port.rebasePlan({
          workspacePath: scope.root!,
          trusted: true,
          activation: snapshot.activation,
          revision: snapshot.revision,
          upstream,
        });
        if (
          !current(scope) ||
          latest.current.port !== port ||
          sequence.current !== request ||
          scope.snapshot !== snapshot
        )
          return false;
        if (
          value.activation !== snapshot.activation ||
          value.revision !== snapshot.revision ||
          value.upstream !== upstream ||
          value.branch !== snapshot.branch ||
          value.originalHead !== snapshot.head ||
          value.onto !== snapshot.localBranches.find((branch) => branch.name === upstream)?.head ||
          !/^[a-f0-9]{64}$/u.test(value.fingerprint)
        )
          throw new Error("Rebase review no longer matches this branch. Refresh Git.");
        scope.rebasePlan = value;
        return true;
      } catch (error) {
        if (current(scope) && sequence.current === request) {
          scope.snapshot = null;
          scope.error = errorMessage(error);
        }
        return false;
      } finally {
        if (liveScope.current === scope && sequence.current === request) {
          scope.busy = null;
          update();
        }
      }
    },
    [scope, dependencies.port, current, update],
  );
  const startRebase = useCallback(async () => {
    const snapshot = scope.snapshot,
      plan = scope.rebasePlan;
    if (
      !current(scope) ||
      !snapshot ||
      !plan ||
      plan.revision !== snapshot.revision ||
      snapshot.rebase
    )
      return false;
    return mutate({
      workspacePath: scope.root!,
      trusted: true,
      activation: snapshot.activation,
      revision: snapshot.revision,
      kind: "startRebase",
      upstream: plan.upstream,
      planFingerprint: plan.fingerprint,
    });
  }, [scope, current, mutate]);
  const rebaseAction = useCallback(
    async (kind: "continueRebase" | "skipRebase" | "abortRebase") => {
      const snapshot = scope.snapshot,
        review = scope.review;
      if (!current(scope) || !snapshot?.rebase) return false;
      if (
        kind === "continueRebase" &&
        (!review?.staged ||
          review.path !== null ||
          review.revision !== snapshot.revision ||
          snapshot.files.some((file) => file.conflict))
      )
        return false;
      return mutate({
        workspacePath: scope.root!,
        trusted: true,
        activation: snapshot.activation,
        revision: snapshot.revision,
        kind,
      });
    },
    [scope, current, mutate],
  );
  const branchAction = useCallback(
    async (kind: "createBranch" | "switchBranch" | "mergeBranch", name: string) => {
      const snapshot = scope.snapshot;
      if (
        !current(scope) ||
        !snapshot ||
        !snapshot.head ||
        !name ||
        ((kind === "switchBranch" || kind === "mergeBranch") &&
          (snapshot.mergeHeads?.length ||
            snapshot.branch === name ||
            snapshot.commitUnavailableReason ||
            !snapshot.localBranches.some((branch) => branch.name === name)))
      )
        return false;
      return mutate({
        workspacePath: scope.root!,
        trusted: true,
        activation: snapshot.activation,
        revision: snapshot.revision,
        kind,
        name,
      });
    },
    [scope, current, mutate],
  );
  const abortMerge = useCallback(async () => {
    const snapshot = scope.snapshot;
    if (!current(scope) || !snapshot?.mergeHeads?.length) return false;
    return mutate({
      workspacePath: scope.root!,
      trusted: true,
      activation: snapshot.activation,
      revision: snapshot.revision,
      kind: "abortMerge",
    });
  }, [scope, current, mutate]);
  const renameBranch = useCallback(
    async (oldName: string, name: string) => {
      const snapshot = scope.snapshot;
      if (
        !current(scope) ||
        !snapshot?.head ||
        !oldName ||
        !name ||
        name === oldName ||
        !snapshot.localBranches.some((branch) => branch.name === oldName) ||
        snapshot.localBranches.some((branch) => branch.name === name)
      )
        return false;
      return mutate({
        workspacePath: scope.root!,
        trusted: true,
        activation: snapshot.activation,
        revision: snapshot.revision,
        kind: "renameBranch",
        oldName,
        name,
      });
    },
    [scope, current, mutate],
  );
  const stage = useCallback(async () => {
    const snapshot = scope.snapshot,
      selection = scope.review;
    if (
      !current(scope) ||
      !snapshot ||
      !selection ||
      selection.staged ||
      !selection.path ||
      !selection.savedFingerprint ||
      selection.revision !== snapshot.revision
    )
      return false;
    if (latest.current.isDirty(selection.path)) {
      scope.error =
        "Save or discard this file's unsaved editor changes before staging. Git actions never save editor buffers.";
      update();
      return false;
    }
    return mutate({
      workspacePath: scope.root!,
      trusted: true,
      activation: snapshot.activation,
      revision: snapshot.revision,
      kind: "stage",
      path: selection.path,
      savedFingerprint: selection.savedFingerprint,
    });
  }, [scope, current, update, mutate]);
  const unstage = useCallback(
    async (path: string) => {
      const snapshot = scope.snapshot;
      if (!current(scope) || !snapshot?.files.some((file) => file.path === path && file.staged))
        return false;
      return mutate({
        workspacePath: scope.root!,
        trusted: true,
        activation: snapshot.activation,
        revision: snapshot.revision,
        kind: "unstage",
        path,
      });
    },
    [scope, current, mutate],
  );
  const commit = useCallback(async () => {
    const snapshot = scope.snapshot,
      selection = scope.review;
    if (
      !current(scope) ||
      !snapshot ||
      snapshot.commitUnavailableReason ||
      !selection?.staged ||
      selection.path !== null ||
      selection.revision !== snapshot.revision ||
      (!snapshot.files.some((file) => file.staged) && !snapshot.mergeHeads?.length) ||
      !scope.message.trim() ||
      !scope.authorName.trim() ||
      !scope.authorEmail.trim()
    )
      return false;
    return mutate({
      workspacePath: scope.root!,
      trusted: true,
      activation: snapshot.activation,
      revision: snapshot.revision,
      kind: "commit",
      message: scope.message,
      authorName: scope.authorName,
      authorEmail: scope.authorEmail,
    });
  }, [scope, current, mutate]);
  const setMessage = useCallback(
    (value: string) => {
      scope.message = value;
      update();
    },
    [scope, update],
  );
  const openFile = useCallback(
    async (path: string) => {
      if (
        !current(scope) ||
        writing.current ||
        (scope.blame?.path !== path &&
          !scope.snapshot?.files.some(
            (file) =>
              file.path === path &&
              !file.directory &&
              file.worktree !== "D" &&
              !(file.index === "D" && !file.unstaged),
          ))
      )
        return false;
      try {
        const opened = await latest.current.openFile(path);
        if (!current(scope)) return false;
        if (!opened) {
          scope.error = "The Git file could not be opened. Refresh the changes and retry.";
          update();
        }
        return opened;
      } catch {
        if (current(scope)) {
          scope.error = "The Git file could not be opened. Refresh the changes and retry.";
          update();
        }
        return false;
      }
    },
    [scope, current, update],
  );
  const setAuthorName = useCallback(
    (value: string) => {
      scope.authorName = value;
      update();
    },
    [scope, update],
  );
  const setAuthorEmail = useCallback(
    (value: string) => {
      scope.authorEmail = value;
      update();
    },
    [scope, update],
  );
  const available = current(scope);
  const snapshot = available ? scope.snapshot : null,
    selection = available ? scope.review : null;
  return {
    available,
    workspaceKey: JSON.stringify([scope.workspaceId, scope.root, scope.generation]),
    supportsBranchDelete: Boolean(dependencies.port?.branchDeletePlan),
    branchDeletePlan:
      snapshot && scope.deletePlan?.revision === snapshot.revision ? scope.deletePlan : null,
    prepareBranchDelete,
    deleteReviewedBranch,
    supportsRebase: Boolean(dependencies.port?.rebasePlan),
    rebasePlan: available ? scope.rebasePlan : null,
    prepareRebase,
    startRebase,
    rebaseAction,
    canContinueRebase: Boolean(
      snapshot?.rebase &&
      selection?.staged &&
      selection.path === null &&
      selection.revision === snapshot.revision &&
      !snapshot.files.some((file) => file.conflict),
    ),
    supportsHistory: Boolean(dependencies.port?.history && dependencies.port?.commitReview),
    historySelection:
      snapshot && scope.history?.revision === snapshot.revision ? scope.history : null,
    commitSelection:
      snapshot && scope.commitReview?.revision === snapshot.revision ? scope.commitReview : null,
    loadHistory,
    reviewCommit,
    supportsBlame: Boolean(dependencies.port?.blame),
    activeFilePath:
      dependencies.activeFilePath && isNormalizedWorkspaceRelativePath(dependencies.activeFilePath)
        ? dependencies.activeFilePath
        : null,
    blameSelection: available ? scope.blame : null,
    blameFile,
    openBlameLine,
    supportsBlameLineNavigation: Boolean(dependencies.openBlameLocation),
    trusted: available && scope.trusted,
    snapshot,
    selection,
    busy: available ? scope.busy : null,
    isWriting: writing.current,
    error: available ? scope.error : null,
    status: available ? scope.status : null,
    message: scope.message,
    authorName: scope.authorName,
    authorEmail: scope.authorEmail,
    setTrusted,
    refresh,
    review,
    stage,
    unstage,
    commit,
    branchAction,
    renameBranch,
    abortMerge,
    setMessage,
    setAuthorName,
    setAuthorEmail,
    openFile,
    isDirty: dependencies.isDirty,
    mutationsAvailable: dependencies.canMutate(),
    branchSwitchUnavailableReason:
      snapshot && snapshot.repositoryRoot !== scope.root
        ? "Open the repository root before switching branches."
        : null,
    canCommit: Boolean(
      dependencies.canMutate() &&
      snapshot &&
      selection?.staged &&
      selection.path === null &&
      selection.revision === snapshot.revision &&
      !snapshot.commitUnavailableReason &&
      (snapshot.files.some((file) => file.staged) || !!snapshot.mergeHeads?.length) &&
      scope.message.trim() &&
      scope.authorName.trim() &&
      scope.authorEmail.trim() &&
      !scope.busy,
    ),
  };
}
export type GitWorkspaceController = ReturnType<typeof useGitWorkspaceController>;
