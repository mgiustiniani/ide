import type {
  JavaDatabaseEstimatedPlanResult,
  JavaDatabaseConnectionResult,
  JavaDatabaseParameter,
  JavaDatabaseQueryResult,
  JavaDatabaseCancelRequest,
  JavaDatabaseSessionScope,
  JavaDatabaseSessionState,
  JavaDatabaseTransactionAction,
} from "@ide/contracts";
import type { JavaDatabasePort } from "@ide/web-core/ports";
import { useCallback, useEffect, useRef, useState } from "react";
import type { JavaDatabaseConnectionDraft } from "./useJavaDatabaseController";

type Busy =
  "connect" | "refresh" | "query" | "transaction" | "disconnect" | "workspace" | "cancel" | null;
interface State {
  busy: Busy;
  preserveQueryDraft: boolean;
  error: string | null;
  notice: string | null;
  connection: JavaDatabaseConnectionResult | null;
  queryResult: JavaDatabaseQueryResult | JavaDatabaseEstimatedPlanResult | null;
  session: JavaDatabaseSessionState | null;
}
const empty: State = {
  preserveQueryDraft: false,
  busy: null,
  error: null,
  notice: null,
  connection: null,
  queryResult: null,
  session: null,
};
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
export function databaseTransitionReason(busy: boolean, session: JavaDatabaseSessionState | null) {
  if (busy)
    return "Wait for the database operation to finish before closing the IDE or switching workspaces.";
  if (session && !session.autoCommit && session.statementsSinceBoundary > 0)
    return "Commit, roll back, or explicitly disconnect the database before closing the IDE or switching workspaces.";
  return null;
}

export function useJavaDatabaseSessionController(
  port: JavaDatabasePort,
  workspaceId: string | null,
  generation: number,
  jdkHome: string,
  switching: boolean,
  onTransitionBlockReason?: (reason: string | null) => void,
) {
  const [state, setState] = useState<State>(empty);
  const stateWorkspace = useRef(workspaceId);
  const current = useRef({ workspaceId, generation, switching, port });
  current.current = { workspaceId, generation, switching, port };
  const metadata = useRef(state.connection);
  metadata.current = state.connection;
  const active = useRef<{
    scope: JavaDatabaseSessionScope;
    session: JavaDatabaseSessionState;
  } | null>(null);
  const busy = useRef(false);
  const stopping = useRef(false);
  const opening = useRef<Pick<
    JavaDatabaseSessionScope,
    "workspaceId" | "generation" | "requestId"
  > | null>(null);
  const alive = useRef(true);
  const sequence = useRef(0);
  const operation = useRef(0);
  const observer = useRef(onTransitionBlockReason);
  observer.current = onTransitionBlockReason;
  const publishGuard = useCallback(() => {
    observer.current?.(databaseTransitionReason(busy.current, active.current?.session ?? null));
  }, []);
  const scope = useCallback((): JavaDatabaseSessionScope => {
    if (
      !active.current ||
      !current.current.workspaceId ||
      active.current.scope.workspaceId !== current.current.workspaceId
    )
      throw new Error("Connect to a database first.");
    return {
      workspaceId: current.current.workspaceId,
      generation: current.current.generation,
      sessionId: active.current.session.sessionId,
      requestId: "database-session-" + Date.now() + "-" + ++sequence.current,
    };
  }, []);
  const usableSession = useCallback(
    () =>
      Boolean(
        alive.current &&
        active.current &&
        !current.current.switching &&
        active.current.scope.workspaceId === current.current.workspaceId &&
        active.current.scope.generation === current.current.generation,
      ),
    [],
  );
  const matches = useCallback(
    (request: JavaDatabaseSessionScope, task: number) =>
      task === operation.current &&
      alive.current &&
      current.current.workspaceId === request.workspaceId &&
      current.current.generation === request.generation &&
      active.current?.session.sessionId === request.sessionId,
    [],
  );
  const updateSession = useCallback(
    (session: JavaDatabaseSessionState) => {
      if (active.current) active.current.session = session;
      publishGuard();
      setState((s) => ({ ...s, session }));
    },
    [publishGuard],
  );
  const begin = useCallback(
    (kind: Busy) => {
      busy.current = true;
      publishGuard();
      setState((s) => ({ ...s, busy: kind, error: null, notice: null }));
      return ++operation.current;
    },
    [publishGuard],
  );
  const finish = useCallback(
    (task: number) => {
      if (task !== operation.current) return;
      busy.current = false;
      publishGuard();
      if (alive.current) setState((s) => ({ ...s, busy: null }));
    },
    [publishGuard],
  );
  const recover = useCallback(
    async (request: JavaDatabaseSessionScope, error: unknown, task: number) => {
      if (!matches(request, task)) return;
      try {
        const result = await port.controlSession!({
          ...request,
          requestId: request.requestId + "-status",
          action: "status",
        });
        if (!matches(request, task)) return;
        updateSession(result.session);
        setState((s) => ({ ...s, error: message(error) }));
      } catch {
        if (!matches(request, task)) return;
        active.current = null;
        setState({
          ...empty,
          preserveQueryDraft: true,
          error:
            message(error) +
            " The database session is unavailable; the last operation's outcome is not confirmed.",
        });
      }
    },
    [matches, port, updateSession],
  );

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      const captured = active.current;
      if (captured && port.closeSession) {
        // Cleanup must never silently discard pending work. Normal workspace/close guards run first.
        void port
          .closeSession({
            ...captured.scope,
            requestId: "database-cleanup-" + ++sequence.current,
            allowRollback: false,
          })
          .catch(() => {});
      }
    };
  }, [port]);

  useEffect(() => {
    if (switching) return;
    const captured = active.current;
    if (stateWorkspace.current !== workspaceId) {
      stateWorkspace.current = workspaceId;
      active.current = null;
      opening.current = null;
      operation.current++;
      busy.current = false;
      publishGuard();
      setState({ ...empty });
      if (captured)
        void port
          .closeSession?.({
            ...captured.scope,
            requestId: "database-retire-" + ++sequence.current,
            allowRollback: false,
          })
          .catch(() => {});
      return;
    }
    if (!captured) return;
    if (captured.scope.generation === generation || busy.current) return;
    // A failed workspace switch can advance the UI generation without changing native ownership.
    const request = scope();
    const task = begin("workspace");
    void port.controlSession!({ ...request, action: "status" })
      .then((result) => {
        if (!matches(request, task)) return;
        captured.scope = request;
        updateSession(result.session);
      })
      .catch((error: unknown) => {
        if (!matches(request, task)) return;
        active.current = null;
        setState({ ...empty, preserveQueryDraft: true, error: message(error) });
      })
      .finally(() => finish(task));
  }, [
    workspaceId,
    generation,
    switching,
    begin,
    finish,
    matches,
    port,
    publishGuard,
    scope,
    updateSession,
  ]);

  const connect = useCallback(
    async (draft: JavaDatabaseConnectionDraft) => {
      const owner = current.current;
      if (
        !port.connectSession ||
        !alive.current ||
        !owner.workspaceId ||
        stateWorkspace.current !== owner.workspaceId ||
        owner.switching ||
        busy.current ||
        active.current
      )
        return;
      const task = begin("connect");
      const request = {
        ...draft,
        workspaceId: owner.workspaceId,
        generation: owner.generation,
        jdkHome,
        requestId: "database-connect-" + Date.now() + "-" + ++sequence.current,
      };
      opening.current = {
        workspaceId: request.workspaceId,
        generation: request.generation,
        requestId: request.requestId,
      };
      try {
        const result = await port.connectSession(request);
        if (
          task !== operation.current ||
          !alive.current ||
          current.current.workspaceId !== owner.workspaceId ||
          current.current.generation !== owner.generation
        ) {
          await port.closeSession!({
            workspaceId: request.workspaceId,
            generation: request.generation,
            requestId: request.requestId + "-stale",
            sessionId: result.session.sessionId,
            allowRollback: false,
          });
          return;
        }
        if (
          result.workspaceId !== request.workspaceId ||
          result.generation !== request.generation ||
          result.requestId !== request.requestId
        )
          throw new Error("The database metadata does not match the selected workspace.");
        active.current = {
          scope: {
            workspaceId: request.workspaceId,
            generation: request.generation,
            requestId: request.requestId,
            sessionId: result.session.sessionId,
          },
          session: result.session,
        };
        setState({ ...empty, connection: result, session: result.session });
      } catch (error) {
        if (
          task === operation.current &&
          alive.current &&
          current.current.workspaceId === owner.workspaceId &&
          current.current.generation === owner.generation
        )
          setState({ ...empty, preserveQueryDraft: true, error: message(error) });
      } finally {
        if (opening.current?.requestId === request.requestId) opening.current = null;
        finish(task);
      }
    },
    [begin, finish, jdkHome, port],
  );

  const submit = useCallback(
    async (
      sql: string,
      parameters: JavaDatabaseParameter[] | undefined,
      estimatedPlan: boolean,
    ) => {
      if (!active.current || !usableSession() || busy.current || current.current.port !== port)
        return;
      if (
        estimatedPlan &&
        (!port.explainSession || metadata.current?.estimatedPlanDialect !== "h2")
      )
        return;
      const request = scope();
      const task = begin("query");
      if (!active.current.session.autoCommit)
        active.current.session = {
          ...active.current.session,
          statementsSinceBoundary: Math.min(
            1_000_000,
            active.current.session.statementsSinceBoundary + 1,
          ),
        };
      setState((s) => ({ ...s, queryResult: null }));
      try {
        const input = {
          ...request,
          sql,
          ...(parameters === undefined ? {} : { parameters: parameters.map((p) => ({ ...p })) }),
        };
        const result = estimatedPlan
          ? await port.explainSession!(input)
          : await port.executeSession!(input);
        if (current.current.port !== port || !matches(request, task)) return;
        updateSession(result.session);
        setState((s) => ({ ...s, queryResult: result }));
      } catch (error) {
        await recover(request, error, task);
      } finally {
        finish(task);
      }
    },
    [begin, finish, matches, port, recover, scope, updateSession, usableSession],
  );

  const execute = useCallback(
    (sql: string, parameters?: JavaDatabaseParameter[]) => submit(sql, parameters, false),
    [submit],
  );
  const explain = useCallback(
    (sql: string, parameters?: JavaDatabaseParameter[]) => submit(sql, parameters, true),
    [submit],
  );

  const refreshSchema = useCallback(async () => {
    if (!active.current || !usableSession() || busy.current) return;
    const request = scope();
    const task = begin("refresh");
    try {
      const result = await port.inspectSession!(request);
      if (!matches(request, task)) return;
      updateSession(result.session);
      setState((s) => ({ ...s, connection: result }));
    } catch (error) {
      await recover(request, error, task);
    } finally {
      finish(task);
    }
  }, [begin, finish, matches, port, recover, scope, updateSession, usableSession]);

  const controlTransaction = useCallback(
    async (action: JavaDatabaseTransactionAction) => {
      if (!active.current || !usableSession() || busy.current) return;
      const request = scope();
      const task = begin("transaction");
      try {
        const result = await port.controlSession!({ ...request, action });
        if (!matches(request, task)) return;
        updateSession(result.session);
        const notices = {
          begin: "Auto-commit disabled. Commit or roll back your work explicitly.",
          commit: "Commit confirmed. Auto-commit remains off.",
          rollback: "Rollback confirmed. Auto-commit remains off.",
          "auto-commit": "Auto-commit enabled.",
          status: "Database session is connected.",
        };
        setState((s) => ({ ...s, notice: notices[action] }));
      } catch (error) {
        await recover(request, error, task);
      } finally {
        finish(task);
      }
    },
    [begin, finish, matches, port, recover, scope, updateSession, usableSession],
  );

  const disconnect = useCallback(async () => {
    if (!active.current || !usableSession() || busy.current) return;
    const request = scope();
    const manual = !active.current.session.autoCommit;
    const task = begin("disconnect");
    try {
      const result = await port.closeSession!({ ...request, allowRollback: true });
      if (!matches(request, task)) return;
      active.current = null;
      setState({
        ...empty,
        notice: manual && !result.rollbackConfirmed ? null : "Database disconnected.",
        error:
          manual && !result.rollbackConfirmed
            ? "Disconnected without confirmation of rollback. Check the database before continuing."
            : null,
      });
    } catch (error) {
      await recover(request, error, task);
    } finally {
      finish(task);
    }
  }, [begin, finish, matches, port, recover, scope, usableSession]);

  const cancel = useCallback(async () => {
    if (
      !port.cancelSession ||
      stopping.current ||
      current.current.switching ||
      !busy.current ||
      state.busy === "cancel" ||
      state.busy === "disconnect"
    )
      return;
    const owner = current.current;
    const connection = active.current;
    const startup = opening.current;
    if (
      !owner.workspaceId ||
      (!connection && !startup) ||
      (connection && connection.scope.workspaceId !== owner.workspaceId) ||
      (startup && startup.workspaceId !== owner.workspaceId)
    )
      return;
    const request: JavaDatabaseCancelRequest = {
      workspaceId: owner.workspaceId,
      generation: owner.generation,
      requestId: "database-stop-" + Date.now() + "-" + ++sequence.current,
      ...(connection
        ? { sessionId: connection.session.sessionId }
        : { connectionRequestId: startup!.requestId }),
    };
    stopping.current = true;
    const task = begin("cancel");
    const isCurrent = () =>
      alive.current &&
      task === operation.current &&
      current.current.workspaceId === owner.workspaceId &&
      current.current.generation === owner.generation;
    try {
      await port.cancelSession(request);
      if (!isCurrent()) return;
      active.current = null;
      opening.current = null;
      setState({
        ...empty,
        preserveQueryDraft: true,
        error:
          "The JDBC worker has stopped. The database outcome is not confirmed; check the database before retrying. SQL and parameters remain available for review.",
      });
    } catch (error) {
      if (!isCurrent()) return;
      if (connection) {
        await recover(
          {
            workspaceId: request.workspaceId,
            generation: request.generation,
            requestId: request.requestId,
            sessionId: connection.session.sessionId,
          },
          new Error("Stop was not confirmed. " + message(error)),
          task,
        );
      } else {
        setState((s) => ({ ...s, error: "Stop was not confirmed. " + message(error) }));
      }
    } finally {
      stopping.current = false;
      finish(task);
    }
  }, [begin, finish, port, recover, state.busy]);

  const ownedView = stateWorkspace.current === workspaceId;
  const resuming = Boolean(
    active.current &&
    active.current.scope.workspaceId === workspaceId &&
    active.current.scope.generation !== generation,
  );
  const visible = ownedView && !switching && !resuming;
  const retainedDraft = ownedView && Boolean(state.connection) && (switching || resuming);
  return {
    ...(ownedView ? state : empty),
    connection: visible ? state.connection : null,
    queryResult: visible ? state.queryResult : null,
    preserveQueryDraft: ownedView && (state.preserveQueryDraft || retainedDraft),
    preserveConnectionDraft: retainedDraft,
    busy: switching || resuming ? ("workspace" as const) : ownedView ? state.busy : null,
    sessionCapable: true,
    workspaceAvailable: workspaceId !== null && !switching && ownedView,
    canCancel: Boolean(
      port.cancelSession &&
      visible &&
      state.busy &&
      ["connect", "refresh", "query", "transaction"].includes(state.busy),
    ),
    canExplain: Boolean(
      visible &&
      usableSession() &&
      port.explainSession &&
      state.connection?.estimatedPlanDialect === "h2",
    ),
    connect,
    execute,
    explain,
    refreshSchema,
    controlTransaction,
    disconnect,
    cancel,
  };
}
