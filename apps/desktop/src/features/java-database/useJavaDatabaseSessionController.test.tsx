import { act, renderHook } from "@testing-library/react";
import type { JavaDatabaseSessionState, JavaDatabaseTransactionRequest } from "@ide/contracts";
import type { JavaDatabasePort } from "@ide/web-core/ports";
import { describe, expect, it, vi } from "vitest";
import { useJavaDatabaseController } from "./useJavaDatabaseController";

function harness() {
  let session: JavaDatabaseSessionState = {
    sessionId: "a".repeat(32),
    autoCommit: true,
    supportsTransactions: true,
    ddlCausesCommit: true,
    statementsSinceBoundary: 0,
  };
  const schema = {
    productName: "H2",
    productVersion: "2.4.240",
    estimatedPlanDialect: "h2" as const,
    tables: [],
    truncated: false,
    elapsedMs: 1,
  };
  const port: JavaDatabasePort = {
    inspect: vi.fn(),
    execute: vi.fn(),
    connectSession: vi.fn(async (request) => ({ ...request, ...schema, session: { ...session } })),
    inspectSession: vi.fn(async (request) => ({ ...request, ...schema, session: { ...session } })),
    executeSession: vi.fn(async (request) => {
      if (!session.autoCommit) session.statementsSinceBoundary++;
      return {
        ...request,
        columns: [],
        rows: [],
        rowsTruncated: false,
        updateCount: 1,
        elapsedMs: 1,
        session: { ...session },
      };
    }),
    controlSession: vi.fn(async (request: JavaDatabaseTransactionRequest) => {
      if (request.action === "begin") session.autoCommit = false;
      if (["commit", "rollback"].includes(request.action)) session.statementsSinceBoundary = 0;
      if (request.action === "auto-commit") session.autoCommit = true;
      const outcomes = {
        begin: "transaction-started",
        commit: "committed",
        rollback: "rolled-back",
        "auto-commit": "auto-commit-enabled",
        status: "status",
      } as const;
      return { ...request, session: { ...session }, outcome: outcomes[request.action] };
    }),
    closeSession: vi.fn(async (request) => ({
      ...request,
      closed: true,
      rollbackConfirmed: !session.autoCommit,
    })),
  };
  const guard = vi.fn();
  const frames: {
    workspaceId: string;
    connectionOwner: string | null;
    resultOwner: string | null;
    error: string | null;
  }[] = [];
  const hook = renderHook(
    ({ generation, switching, workspaceId }) => {
      const value = useJavaDatabaseController(
        port,
        workspaceId,
        generation,
        "/jdk",
        switching,
        guard,
      );
      frames.push({
        workspaceId,
        connectionOwner: value.connection?.workspaceId ?? null,
        resultOwner: value.queryResult?.workspaceId ?? null,
        error: value.error,
      });
      return value;
    },
    { initialProps: { generation: 1, switching: false, workspaceId: "one" } },
  );
  const connect = () =>
    act(() =>
      hook.result.current.connect({
        driverJarPath: "driver.jar",
        jdbcUrl: "jdbc:h2:mem:test",
        username: "sa",
        password: "secret",
      }),
    );
  return {
    hook,
    port,
    guard,
    connect,
    frames,
    setSession: (s: JavaDatabaseSessionState) => {
      session = s;
    },
  };
}

describe("persistent JDBC controller", () => {
  it("guards pending manual work synchronously, keeps a session through a failed workspace switch, and confirms rollback", async () => {
    const { hook, port, guard, connect } = harness();
    await connect();
    await act(() => hook.result.current.controlTransaction("begin"));
    await act(() =>
      hook.result.current.execute("INSERT INTO notes VALUES (?)", [
        { type: "string", value: "exact' text" },
      ]),
    );
    expect(guard).toHaveBeenLastCalledWith(expect.stringContaining("Commit, roll back"));
    expect(port.execute).not.toHaveBeenCalled();
    const submitted = vi.mocked(port.executeSession!).mock.calls[0][0];
    expect(submitted).not.toHaveProperty("password");
    expect(submitted).not.toHaveProperty("jdbcUrl");
    expect(submitted.parameters).toEqual([{ type: "string", value: "exact' text" }]);
    hook.rerender({ workspaceId: "one", generation: 2, switching: true });
    expect(hook.result.current.session?.statementsSinceBoundary).toBe(1);
    expect(port.closeSession).not.toHaveBeenCalled();
    await act(async () => hook.rerender({ workspaceId: "one", generation: 2, switching: false }));
    expect(port.controlSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: "status", generation: 2 }),
    );
    expect(hook.result.current.session?.statementsSinceBoundary).toBe(1);
    await act(() => hook.result.current.controlTransaction("rollback"));
    expect(hook.result.current.notice).toBe("Rollback confirmed. Auto-commit remains off.");
    expect(hook.result.current.session?.autoCommit).toBe(false);
    expect(guard).toHaveBeenLastCalledWith(null);
    await act(() => hook.result.current.disconnect());
    expect(port.closeSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ allowRollback: true, generation: 2 }),
    );
    expect(hook.result.current.connection).toBeNull();
  });

  it("retains a recoverable SQL error and manual work but refuses to invent a successful transaction after session loss", async () => {
    const { hook, port, guard, connect, setSession } = harness();
    await connect();
    await act(() => hook.result.current.controlTransaction("begin"));
    setSession({ ...hook.result.current.session!, statementsSinceBoundary: 1 });
    vi.mocked(port.executeSession!).mockRejectedValueOnce(new Error("invalid SQL"));
    await act(() => hook.result.current.execute("bad SQL"));
    expect(hook.result.current.connection).not.toBeNull();
    expect(hook.result.current.error).toBe("invalid SQL");
    expect(guard).toHaveBeenLastCalledWith(expect.stringContaining("Commit, roll back"));
    vi.mocked(port.controlSession!).mockRejectedValue(new Error("worker lost"));
    await act(() => hook.result.current.controlTransaction("commit"));
    expect(hook.result.current.connection).toBeNull();
    expect(hook.result.current.notice).toBeNull();
    expect(hook.result.current.error).toContain("outcome is not confirmed");
  });

  it("does not fall back to per-operation connections when session startup fails", async () => {
    const { hook, port, connect } = harness();
    vi.mocked(port.connectSession!).mockRejectedValueOnce(new Error("JDK unavailable"));
    await connect();
    expect(port.inspect).not.toHaveBeenCalled();
    expect(hook.result.current.error).toBe("JDK unavailable");
    expect(hook.result.current.connection).toBeNull();
  });

  it("only requests nondestructive cleanup when the feature is unmounted", async () => {
    const { hook, port, connect } = harness();
    await connect();
    await act(() => hook.result.current.controlTransaction("begin"));
    await act(() => hook.result.current.execute("SELECT 1"));
    hook.unmount();
    expect(port.closeSession).toHaveBeenCalledWith(
      expect.objectContaining({ allowRollback: false }),
    );
    expect(vi.mocked(port.closeSession!).mock.calls[0][0]).not.toHaveProperty("password");
  });
});

it("closes a stale startup without forwarding connection credentials to the close command", async () => {
  const { hook, port } = harness();
  let resolve!: (
    value: Awaited<ReturnType<NonNullable<JavaDatabasePort["connectSession"]>>>,
  ) => void;
  let captured!: Parameters<NonNullable<JavaDatabasePort["connectSession"]>>[0];
  vi.mocked(port.connectSession!).mockImplementationOnce((request) => {
    captured = request;
    return new Promise((done) => {
      resolve = done;
    });
  });
  let started!: Promise<void>;
  act(() => {
    started = hook.result.current.connect({
      driverJarPath: "driver.jar",
      jdbcUrl: "jdbc:h2:mem:test",
      username: "sa",
      password: "secret",
    });
  });
  hook.rerender({ workspaceId: "two", generation: 2, switching: false });
  await act(async () => {
    resolve({
      ...captured,
      productName: "H2",
      productVersion: "2.4.240",
      tables: [],
      truncated: false,
      elapsedMs: 1,
      session: {
        sessionId: "a".repeat(32),
        autoCommit: true,
        supportsTransactions: true,
        ddlCausesCommit: false,
        statementsSinceBoundary: 0,
      },
    });
    await started;
  });
  const close = vi.mocked(port.closeSession!).mock.calls[0][0];
  expect(Object.keys(close).sort()).toEqual([
    "allowRollback",
    "generation",
    "requestId",
    "sessionId",
    "workspaceId",
  ]);
  expect(close.allowRollback).toBe(false);
  expect(close.workspaceId).toBe("one");
  expect(hook.result.current.connection).toBeNull();
});

it("waits for worker-stop confirmation, ignores late SQL success, and retains a reviewable query draft", async () => {
  const { hook, port, connect, guard } = harness();
  let finishQuery!: (
    value: Awaited<ReturnType<NonNullable<JavaDatabasePort["executeSession"]>>>,
  ) => void;
  let finishStop!: (
    value: Awaited<ReturnType<NonNullable<JavaDatabasePort["cancelSession"]>>>,
  ) => void;
  port.cancelSession = vi.fn<NonNullable<JavaDatabasePort["cancelSession"]>>(
    () =>
      new Promise((resolve) => {
        finishStop = resolve;
      }),
  );
  vi.mocked(port.executeSession!).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishQuery = resolve;
      }),
  );
  await connect();
  let query!: Promise<void>;
  act(() => {
    query = hook.result.current.execute("CALL blocking_operation()");
  });
  expect(hook.result.current.canCancel).toBe(true);
  let stop!: Promise<void>;
  act(() => {
    stop = hook.result.current.cancel();
    void hook.result.current.cancel();
  });
  expect(port.cancelSession).toHaveBeenCalledOnce();
  const request = vi.mocked(port.cancelSession!).mock.calls[0][0];
  expect(request).toMatchObject({ workspaceId: "one", generation: 1, sessionId: "a".repeat(32) });
  const submitted = vi.mocked(port.executeSession!).mock.calls[0][0];
  await act(async () => {
    finishQuery({
      ...submitted,
      session: hook.result.current.session!,
      columns: [],
      rows: [],
      rowsTruncated: false,
      updateCount: 1,
      elapsedMs: 1,
    });
    await query;
  });
  expect(hook.result.current.busy).toBe("cancel");
  expect(hook.result.current.queryResult).toBeNull();
  expect(guard).toHaveBeenLastCalledWith(expect.stringContaining("Wait for"));
  await act(async () => {
    finishStop({ ...request, stopped: true, outcome: "unknown" });
    await stop;
  });
  expect(hook.result.current.connection).toBeNull();
  expect(hook.result.current.error).toContain("database outcome is not confirmed");
  expect(hook.result.current.notice).toBeNull();
  expect(hook.result.current.preserveQueryDraft).toBe(true);
  expect(guard).toHaveBeenLastCalledWith(null);
});

it("targets the original connection request when stopping startup and never adopts its late success", async () => {
  const { hook, port } = harness();
  let finishConnect!: (
    value: Awaited<ReturnType<NonNullable<JavaDatabasePort["connectSession"]>>>,
  ) => void;
  vi.mocked(port.connectSession!).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishConnect = resolve;
      }),
  );
  port.cancelSession = vi.fn(async (request) => ({
    ...request,
    stopped: true,
    outcome: "unknown",
  }));
  let connect!: Promise<void>;
  act(() => {
    connect = hook.result.current.connect({
      driverJarPath: "driver.jar",
      jdbcUrl: "jdbc:h2:mem:test",
      username: "sa",
      password: "secret",
    });
  });
  const request = vi.mocked(port.connectSession!).mock.calls[0][0];
  await act(() => hook.result.current.cancel());
  expect(port.cancelSession).toHaveBeenCalledWith(
    expect.objectContaining({ connectionRequestId: request.requestId }),
  );
  expect(vi.mocked(port.cancelSession!).mock.calls[0][0]).not.toHaveProperty("password");
  await act(async () => {
    finishConnect({
      ...request,
      productName: "H2",
      productVersion: "2.4.240",
      tables: [],
      truncated: false,
      elapsedMs: 1,
      session: {
        sessionId: "a".repeat(32),
        autoCommit: true,
        supportsTransactions: true,
        ddlCausesCommit: false,
        statementsSinceBoundary: 0,
      },
    });
    await connect;
  });
  expect(hook.result.current.connection).toBeNull();
  expect(hook.result.current.error).toContain("database outcome is not confirmed");
  expect(port.closeSession).toHaveBeenLastCalledWith(
    expect.objectContaining({ allowRollback: false }),
  );
});

it("never presents a prior workspace's schema or results in a new workspace render", async () => {
  const f = harness();
  await f.connect();
  await act(() => f.hook.result.current.execute("SELECT 1"));
  f.hook.rerender({ workspaceId: "two", generation: 2, switching: true });
  expect(
    f.frames
      .filter((frame) => frame.workspaceId === "two")
      .every((frame) => frame.connectionOwner === null && frame.resultOwner === null),
  ).toBe(true);
  expect(f.hook.result.current.session).toBeNull();
  await act(async () => {
    await f.hook.result.current.execute("DELETE FROM notes");
  });
  expect(f.port.executeSession).toHaveBeenCalledTimes(1);
  f.hook.rerender({ workspaceId: "two", generation: 2, switching: false });
  expect(f.hook.result.current.connection).toBeNull();
  expect(f.port.closeSession).toHaveBeenCalledWith(
    expect.objectContaining({ workspaceId: "one", allowRollback: false }),
  );
});
it("retires old errors on a workspace change even after a connection has been lost", async () => {
  const f = harness();
  vi.mocked(f.port.connectSession!).mockRejectedValueOnce(new Error("old database details"));
  await f.connect();
  expect(f.hook.result.current.error).toBe("old database details");
  f.hook.rerender({ workspaceId: "two", generation: 2, switching: false });
  expect(
    f.frames.filter((frame) => frame.workspaceId === "two").every((frame) => frame.error === null),
  ).toBe(true);
});
it("withholds schema and query actions until a failed-switch generation is confirmed", async () => {
  const f = harness();
  await f.connect();
  let resolve!: (
    value: Awaited<ReturnType<NonNullable<JavaDatabasePort["controlSession"]>>>,
  ) => void;
  vi.mocked(f.port.controlSession!).mockImplementationOnce(
    (request) =>
      new Promise((done) => {
        resolve = (result) => done({ ...result, ...request });
      }),
  );
  f.hook.rerender({ workspaceId: "one", generation: 2, switching: false });
  expect(f.hook.result.current.connection).toBeNull();
  expect(f.hook.result.current.preserveQueryDraft).toBe(true);
  expect(f.hook.result.current.preserveConnectionDraft).toBe(true);
  await act(async () => {
    await f.hook.result.current.execute("DELETE FROM notes");
  });
  expect(f.port.executeSession).not.toHaveBeenCalled();
  await act(async () => {
    resolve({
      workspaceId: "one",
      generation: 2,
      requestId: "status",
      sessionId: f.hook.result.current.session!.sessionId,
      session: f.hook.result.current.session!,
      outcome: "status",
    });
  });
  expect(f.hook.result.current.connection).not.toBeNull();
});

it("keeps an empty database tool available after changing workspaces", () => {
  const f = harness();
  f.hook.rerender({ workspaceId: "two", generation: 2, switching: false });
  expect(f.hook.result.current.workspaceAvailable).toBe(true);
  expect(f.hook.result.current.connection).toBeNull();
});

describe("estimated JDBC plans", () => {
  it("uses the owned session and exact bound values without falling back to ordinary execution", async () => {
    const h = harness();
    h.port.explainSession = vi.fn(async (request) => ({
      ...request,
      planDialect: "h2",
      columns: [{ name: "PLAN", typeName: "VARCHAR" }],
      rows: [["SELECT ... PRIMARY_KEY"]],
      updateCount: null,
      rowsTruncated: false,
      elapsedMs: 1,
      session: { ...h.hook.result.current.session!, statementsSinceBoundary: 1 },
    }));
    await h.connect();
    expect(h.hook.result.current.canExplain).toBe(true);
    await act(() => h.hook.result.current.controlTransaction("begin"));
    const parameters = [{ type: "string" as const, value: "literal'; DELETE FROM notes; --" }];
    await act(() => h.hook.result.current.explain!("SELECT * FROM notes WHERE name=?", parameters));
    parameters[0].value = "changed later";
    expect(h.port.explainSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "a".repeat(32),
        sql: "SELECT * FROM notes WHERE name=?",
        parameters: [{ type: "string", value: "literal'; DELETE FROM notes; --" }],
      }),
    );
    expect(h.port.executeSession).not.toHaveBeenCalled();
    expect(h.port.execute).not.toHaveBeenCalled();
    expect(h.hook.result.current.queryResult).toHaveProperty("planDialect", "h2");
    expect(h.hook.result.current.session?.autoCommit).toBe(false);
    expect(h.guard).toHaveBeenLastCalledWith(expect.stringContaining("Commit, roll back"));
  });
  it("does not infer estimated-plan support from an H2 product name or replay a retained action in another workspace", async () => {
    const h = harness();
    await h.connect();
    expect(h.hook.result.current.canExplain).toBe(false);
    await act(() => h.hook.result.current.explain!("SELECT 1"));
    expect(h.port.executeSession).not.toHaveBeenCalled();
    h.port.explainSession = vi.fn();
    h.hook.rerender({ workspaceId: "one", generation: 1, switching: false });
    const retained = h.hook.result.current.explain!;
    h.hook.rerender({ workspaceId: "other", generation: 2, switching: false });
    await act(() => retained("SELECT 1"));
    expect(h.port.explainSession).not.toHaveBeenCalled();
  });
  it("retains a usable connection after plan refusal and never submits the SQL through ordinary execution", async () => {
    const h = harness();
    h.port.explainSession = vi
      .fn()
      .mockRejectedValue(new Error("Estimate one SQL statement at a time."));
    await h.connect();
    await act(() => h.hook.result.current.explain!("SELECT 1; DELETE FROM notes"));
    expect(h.hook.result.current.error).toContain("one SQL statement");
    expect(h.hook.result.current.connection).not.toBeNull();
    expect(h.port.controlSession).toHaveBeenCalledWith(
      expect.objectContaining({ action: "status" }),
    );
    expect(h.port.executeSession).not.toHaveBeenCalled();
  });
  it("withholds a late plan from a retired workspace", async () => {
    const h = harness();
    let complete!: (value: unknown) => void;
    h.port.explainSession = vi.fn().mockImplementation(
      (request) =>
        new Promise((resolve) => {
          complete = () =>
            resolve({
              ...request,
              planDialect: "h2",
              session: {
                sessionId: "a".repeat(32),
                autoCommit: true,
                supportsTransactions: true,
                ddlCausesCommit: true,
                statementsSinceBoundary: 0,
              },
              columns: [{ name: "PLAN", typeName: "VARCHAR" }],
              rows: [["old"]],
              updateCount: null,
              rowsTruncated: false,
              elapsedMs: 1,
            });
        }),
    );
    await h.connect();
    let pending!: Promise<void>;
    act(() => {
      pending = h.hook.result.current.explain!("SELECT 1");
    });
    h.hook.rerender({ workspaceId: "other", generation: 2, switching: false });
    await act(async () => {
      complete(null);
      await pending;
    });
    expect(h.hook.result.current.queryResult).toBeNull();
  });
});
