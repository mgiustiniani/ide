import type {
  JavaDatabaseConnectionInput,
  JavaDatabaseConnectionResult,
  JavaDatabaseQueryResult,
  JavaDatabaseParameter,
  JavaDatabaseSessionState,
  JavaDatabaseTransactionAction,
} from "@ide/contracts";
import type { JavaDatabasePort } from "@ide/web-core/ports";
import { useJavaDatabaseSessionController } from "./useJavaDatabaseSessionController";
import { useCallback, useEffect, useRef, useState } from "react";

export interface JavaDatabaseConnectionDraft {
  driverJarPath: string;
  jdbcUrl: string;
  username: string;
  password: string;
}

interface ControllerState {
  busy: "connect" | "refresh" | "query" | null;
  error: string | null;
  connection: JavaDatabaseConnectionResult | null;
  queryResult: JavaDatabaseQueryResult | null;
}

const initialState: ControllerState = {
  busy: null,
  error: null,
  connection: null,
  queryResult: null,
};

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "The database operation failed.";
}

function useLegacyJavaDatabaseController(
  port: JavaDatabasePort,
  workspaceId: string | null,
  generation: number,
  jdkHome: string,
) {
  const [state, setState] = useState<ControllerState>(initialState);
  const authority = useRef({ workspaceId, generation });
  authority.current = { workspaceId, generation };
  const stateOwner = useRef({ workspaceId, generation });
  const activeConnection = useRef<JavaDatabaseConnectionInput | null>(null);
  const sequence = useRef(0);
  const busy = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    stateOwner.current = { workspaceId, generation };
    sequence.current += 1;
    busy.current = false;
    activeConnection.current = null;
    setState({ ...initialState });
  }, [workspaceId, generation]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      sequence.current += 1;
      busy.current = false;
      activeConnection.current = null;
    };
  }, []);

  const ownsView = useCallback(
    () =>
      alive.current &&
      authority.current.workspaceId === workspaceId &&
      authority.current.generation === generation &&
      stateOwner.current.workspaceId === workspaceId &&
      stateOwner.current.generation === generation,
    [workspaceId, generation],
  );
  const connect = useCallback(
    async (draft: JavaDatabaseConnectionDraft): Promise<void> => {
      if (!workspaceId || !ownsView() || busy.current) return;
      busy.current = true;
      const requestSequence = ++sequence.current;
      const request: JavaDatabaseConnectionInput = {
        workspaceId,
        generation,
        requestId: "database-" + Date.now() + "-" + requestSequence,
        jdkHome,
        ...draft,
      };
      const isCurrent = () =>
        alive.current &&
        requestSequence === sequence.current &&
        authority.current.workspaceId === workspaceId &&
        authority.current.generation === generation;
      setState({ busy: "connect", error: null, connection: null, queryResult: null });
      try {
        const connection = await port.inspect(request);
        if (!isCurrent()) return;
        if (
          connection.workspaceId !== request.workspaceId ||
          connection.generation !== request.generation ||
          connection.requestId !== request.requestId
        ) {
          throw new Error("The database metadata does not match the selected workspace.");
        }
        activeConnection.current = request;
        setState({ busy: null, error: null, connection, queryResult: null });
      } catch (error) {
        if (isCurrent()) {
          activeConnection.current = null;
          setState({ ...initialState, error: errorText(error) });
        }
      } finally {
        if (requestSequence === sequence.current) busy.current = false;
      }
    },
    [generation, jdkHome, port, workspaceId, ownsView],
  );

  const execute = useCallback(
    async (sql: string, parameters?: JavaDatabaseParameter[]): Promise<void> => {
      const connection = activeConnection.current;
      if (
        !workspaceId ||
        !ownsView() ||
        !connection ||
        connection.workspaceId !== workspaceId ||
        connection.generation !== generation ||
        busy.current
      )
        return;
      busy.current = true;
      const requestSequence = ++sequence.current;
      const request = {
        ...connection,
        generation,
        requestId: "database-" + Date.now() + "-" + requestSequence,
        sql,
        ...(parameters === undefined
          ? {}
          : { parameters: parameters.map((entry) => ({ ...entry })) }),
      };
      const isCurrent = () =>
        alive.current &&
        requestSequence === sequence.current &&
        authority.current.workspaceId === workspaceId &&
        authority.current.generation === generation;
      setState((current) => ({ ...current, busy: "query", error: null, queryResult: null }));
      try {
        const queryResult = await port.execute(request);
        if (!isCurrent()) return;
        if (
          queryResult.workspaceId !== request.workspaceId ||
          queryResult.generation !== request.generation ||
          queryResult.requestId !== request.requestId
        ) {
          throw new Error("The SQL result does not match the selected workspace.");
        }
        setState((current) => ({ ...current, busy: null, error: null, queryResult }));
      } catch (error) {
        if (isCurrent()) {
          setState((current) => ({
            ...current,
            busy: null,
            error: errorText(error),
            queryResult: null,
          }));
        }
      } finally {
        if (requestSequence === sequence.current) busy.current = false;
      }
    },
    [generation, port, workspaceId, ownsView],
  );

  const refreshSchema = useCallback(async (): Promise<void> => {
    const connection = activeConnection.current;
    if (
      !workspaceId ||
      !ownsView() ||
      !connection ||
      connection.workspaceId !== workspaceId ||
      connection.generation !== generation ||
      busy.current
    )
      return;
    busy.current = true;
    const requestSequence = ++sequence.current;
    const request: JavaDatabaseConnectionInput = {
      ...connection,
      generation,
      requestId: "database-" + Date.now() + "-" + requestSequence,
    };
    const isCurrent = () =>
      alive.current &&
      requestSequence === sequence.current &&
      authority.current.workspaceId === workspaceId &&
      authority.current.generation === generation;
    setState((current) => ({ ...current, busy: "refresh", error: null }));
    try {
      const refreshed = await port.inspect(request);
      if (!isCurrent()) return;
      if (
        refreshed.workspaceId !== request.workspaceId ||
        refreshed.generation !== request.generation ||
        refreshed.requestId !== request.requestId
      ) {
        throw new Error("The database metadata does not match the selected workspace.");
      }
      setState((current) => ({ ...current, busy: null, error: null, connection: refreshed }));
    } catch (error) {
      if (isCurrent()) {
        setState((current) => ({ ...current, busy: null, error: errorText(error) }));
      }
    } finally {
      if (requestSequence === sequence.current) busy.current = false;
    }
  }, [generation, port, workspaceId, ownsView]);

  const disconnect = useCallback(() => {
    if (!ownsView()) return;
    sequence.current += 1;
    busy.current = false;
    activeConnection.current = null;
    setState({ ...initialState });
  }, [ownsView]);

  return {
    ...(ownsView() ? state : initialState),
    workspaceAvailable: workspaceId !== null && ownsView(),
    connect,
    refreshSchema,
    execute,
    disconnect,
  };
}

export function useJavaDatabaseController(
  port: JavaDatabasePort,
  workspaceId: string | null,
  generation: number,
  jdkHome: string,
  switching = false,
  onTransitionBlockReason?: (reason: string | null) => void,
) {
  const legacy = useLegacyJavaDatabaseController(port, workspaceId, generation, jdkHome);
  const session = useJavaDatabaseSessionController(
    port,
    workspaceId,
    generation,
    jdkHome,
    switching,
    onTransitionBlockReason,
  );
  const capable = Boolean(
    port.connectSession &&
    port.inspectSession &&
    port.executeSession &&
    port.controlSession &&
    port.closeSession,
  );
  return capable
    ? session
    : {
        ...legacy,
        session: null as JavaDatabaseSessionState | null,
        sessionCapable: false,
        canExplain: false,
        explain: undefined,
        notice: null as string | null,
        connection: !switching ? legacy.connection : null,
        queryResult: !switching ? legacy.queryResult : null,
        busy: switching ? ("workspace" as const) : legacy.busy,
        workspaceAvailable: legacy.workspaceAvailable && !switching,
        canCancel: false,
        preserveQueryDraft: Boolean(switching && legacy.connection),
        preserveConnectionDraft: Boolean(switching && legacy.connection),
        cancel: async () => {},
        controlTransaction: async (_action: JavaDatabaseTransactionAction) => {},
      };
}
