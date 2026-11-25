import { invoke } from "@tauri-apps/api/core";
import type { JavaDatabaseConnectionInput } from "@ide/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  JAVA_DATABASE_EXECUTE_COMMAND,
  JAVA_DATABASE_INSPECT_COMMAND,
  TauriJavaDatabaseAdapter,
} from "./java-database-tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const request: JavaDatabaseConnectionInput = {
  workspaceId: "workspace-one",
  generation: 3,
  requestId: "database-1",
  jdkHome: "/jdk",
  driverJarPath: "drivers/h2.jar",
  jdbcUrl: "jdbc:h2:mem:ide",
  username: "sa",
  password: "secret",
};

describe("Tauri JDBC database adapter", () => {
  beforeEach(() => vi.mocked(invoke).mockReset());

  it("validates correlated schema metadata", async () => {
    const result = {
      workspaceId: request.workspaceId,
      generation: request.generation,
      requestId: request.requestId,
      productName: "H2",
      productVersion: "2.4.240",
      tables: [
        {
          catalog: "IDE",
          schema: "PUBLIC",
          name: "GREETING",
          tableType: "TABLE",
          columns: [{ name: "NAME", typeName: "CHARACTER VARYING", nullable: false }],
          columnsTruncated: false,
        },
      ],
      truncated: false,
      elapsedMs: 4,
    };
    vi.mocked(invoke).mockResolvedValue(result);

    await expect(new TauriJavaDatabaseAdapter().inspect(request)).resolves.toEqual(result);
    expect(invoke).toHaveBeenCalledWith(JAVA_DATABASE_INSPECT_COMMAND, { request });
  });

  it("validates bounded SQL results and rejects stale or malformed data", async () => {
    const sqlRequest = { ...request, requestId: "sql-1", sql: "select name from greeting" };
    const result = {
      workspaceId: request.workspaceId,
      generation: request.generation,
      requestId: sqlRequest.requestId,
      columns: [{ name: "NAME", typeName: "CHARACTER VARYING" }],
      rows: [["Ada"]],
      updateCount: null,
      rowsTruncated: false,
      elapsedMs: 3,
    };
    vi.mocked(invoke).mockResolvedValue(result);

    await expect(new TauriJavaDatabaseAdapter().execute(sqlRequest)).resolves.toEqual(result);
    expect(invoke).toHaveBeenCalledWith(JAVA_DATABASE_EXECUTE_COMMAND, { request: sqlRequest });

    vi.mocked(invoke).mockResolvedValueOnce({ ...result, generation: request.generation + 1 });
    await expect(new TauriJavaDatabaseAdapter().execute(sqlRequest)).rejects.toThrow(
      "Uncorrelated or malformed SQL result",
    );
    vi.mocked(invoke).mockResolvedValueOnce({ ...result, rows: [["Ada", "extra"]] });
    await expect(new TauriJavaDatabaseAdapter().execute(sqlRequest)).rejects.toThrow(
      "Malformed SQL result row",
    );
  });
});

it("forwards bound values and prepared mode without interpolation or numeric conversion", async () => {
  const sqlRequest = {
    ...request,
    sql: "SELECT CAST(? AS BIGINT)",
    parameters: [{ type: "integer" as const, value: "9223372036854775807" }],
  };
  vi.mocked(invoke).mockResolvedValue({
    ...request,
    columns: [{ name: "EXACT_ID", typeName: "BIGINT" }],
    rows: [["9223372036854775807"]],
    updateCount: null,
    rowsTruncated: false,
    elapsedMs: 1,
  });
  const adapter = new TauriJavaDatabaseAdapter();
  await adapter.execute(sqlRequest);
  expect(invoke).toHaveBeenLastCalledWith(JAVA_DATABASE_EXECUTE_COMMAND, { request: sqlRequest });
  const empty = { ...request, sql: "SELECT 1", parameters: [] };
  await adapter.execute(empty);
  expect(invoke).toHaveBeenLastCalledWith(JAVA_DATABASE_EXECUTE_COMMAND, { request: empty });
});

it("correlates persistent session ownership and requires the requested transaction outcome", async () => {
  const adapter = new TauriJavaDatabaseAdapter();
  const session = {
    sessionId: "a".repeat(32),
    autoCommit: false,
    supportsTransactions: true,
    ddlCausesCommit: true,
    statementsSinceBoundary: 0,
  };
  const scope = {
    workspaceId: request.workspaceId,
    generation: request.generation,
    requestId: "commit-1",
    sessionId: session.sessionId,
  };
  vi.mocked(invoke).mockResolvedValueOnce({ ...scope, session, outcome: "committed" });
  await expect(adapter.controlSession({ ...scope, action: "commit" })).resolves.toMatchObject({
    outcome: "committed",
    session,
  });
  expect(invoke).toHaveBeenLastCalledWith("control_java_database_session", {
    request: { ...scope, action: "commit" },
  });
  vi.mocked(invoke).mockResolvedValueOnce({ ...scope, session, outcome: "rolled-back" });
  await expect(adapter.controlSession({ ...scope, action: "commit" })).rejects.toThrow(
    "Uncorrelated",
  );
  vi.mocked(invoke).mockResolvedValueOnce({
    ...scope,
    session: { ...session, sessionId: "b".repeat(32) },
    outcome: "committed",
  });
  await expect(adapter.controlSession({ ...scope, action: "commit" })).rejects.toThrow(
    "mismatched JDBC session",
  );
  vi.mocked(invoke).mockResolvedValueOnce({ ...scope, closed: true });
  await expect(adapter.closeSession({ ...scope, allowRollback: true })).rejects.toThrow(
    "Unconfirmed JDBC disconnect",
  );
  vi.mocked(invoke).mockResolvedValueOnce({ ...scope, closed: true, rollbackConfirmed: true });
  await expect(adapter.closeSession({ ...scope, allowRollback: true })).resolves.toMatchObject({
    closed: true,
    rollbackConfirmed: true,
  });
});

it("accepts only a correlated stop confirmation with an unknown database outcome", async () => {
  const adapter = new TauriJavaDatabaseAdapter();
  const cancellation = {
    workspaceId: request.workspaceId,
    generation: request.generation,
    requestId: "stop-1",
    connectionRequestId: "connect-1",
  };
  vi.mocked(invoke).mockResolvedValueOnce({ ...cancellation, stopped: true, outcome: "unknown" });
  await expect(adapter.cancelSession(cancellation)).resolves.toEqual({
    ...cancellation,
    stopped: true,
    outcome: "unknown",
  });
  expect(invoke).toHaveBeenLastCalledWith("cancel_java_database_session", {
    request: cancellation,
  });
  for (const changed of [
    { connectionRequestId: "another-connect" },
    { stopped: false },
    { outcome: "rolled-back" },
    { sessionId: "b".repeat(32) },
  ]) {
    vi.mocked(invoke).mockResolvedValueOnce({
      ...cancellation,
      stopped: true,
      outcome: "unknown",
      ...changed,
    });
    await expect(adapter.cancelSession(cancellation)).rejects.toThrow("did not confirm");
  }
});

it("preserves driver quoting and current catalog while accepting older metadata without guessing", async () => {
  const base = {
    workspaceId: request.workspaceId,
    generation: request.generation,
    requestId: request.requestId,
    productName: "H2",
    productVersion: "2",
    tables: [],
    truncated: false,
    elapsedMs: 0,
  };
  vi.mocked(invoke).mockResolvedValueOnce({
    ...base,
    identifierQuoteString: '"',
    currentCatalog: "IDE",
  });
  expect(await new TauriJavaDatabaseAdapter().inspect(request)).toMatchObject({
    identifierQuoteString: '"',
    currentCatalog: "IDE",
  });
  vi.mocked(invoke).mockResolvedValueOnce(base);
  expect(
    (await new TauriJavaDatabaseAdapter().inspect(request)).identifierQuoteString,
  ).toBeUndefined();
});
it.each([
  { identifierQuoteString: 7 },
  { identifierQuoteString: "x".repeat(17) },
  { currentCatalog: "" },
  { currentCatalog: 7 },
])("refuses malformed optional identifier metadata", async (fields) => {
  vi.mocked(invoke).mockResolvedValueOnce({
    workspaceId: request.workspaceId,
    generation: request.generation,
    requestId: request.requestId,
    productName: "H2",
    productVersion: "2",
    tables: [],
    truncated: false,
    elapsedMs: 0,
    ...fields,
  });
  await expect(new TauriJavaDatabaseAdapter().inspect(request)).rejects.toThrow(
    "malformed database metadata",
  );
});

describe("captured SQL result export boundary", () => {
  const exportRequest = {
    workspaceId: "ws",
    generation: 2,
    requestId: "export",
    sourceRequestId: "query",
    format: "csv" as const,
    spreadsheetText: true,
    allowPartial: false,
  };
  const exported = {
    ...exportRequest,
    filePath: "/tmp/résultat.csv",
    byteLength: 100,
    rowCount: 2,
    rowsTruncated: false,
  };
  beforeEach(() => vi.mocked(invoke).mockReset());
  it("sends only result identity and export options, and distinguishes cancellation", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(exported).mockResolvedValueOnce(null);
    const adapter = new TauriJavaDatabaseAdapter();
    await expect(adapter.exportResult(exportRequest)).resolves.toEqual(exported);
    expect(invoke).toHaveBeenCalledWith("export_java_database_result", { request: exportRequest });
    await expect(adapter.exportResult(exportRequest)).resolves.toBeNull();
  });
  it.each([
    { workspaceId: "other" },
    { generation: 3 },
    { requestId: "stale" },
    { sourceRequestId: "stale" },
    { format: "json" },
    { filePath: "relative.csv" },
    { filePath: "/tmp/wrong.json" },
    { filePath: "/tmp/control\n.csv" },
    { byteLength: 2 * 1024 * 1024 + 1 },
    { rowCount: 201 },
    { rowCount: 1.5 },
    { rowsTruncated: true },
    { spreadsheetText: false },
  ])("refuses mismatched or malformed export response %o", async (patch) => {
    vi.mocked(invoke).mockResolvedValue({ ...exported, ...patch });
    await expect(new TauriJavaDatabaseAdapter().exportResult(exportRequest)).rejects.toThrow(
      /SQL result export/,
    );
  });
});

describe("estimated JDBC plan boundary", () => {
  const scope = {
    workspaceId: "one",
    generation: 2,
    requestId: "plan",
    sessionId: "a".repeat(32),
    sql: "SELECT name FROM notes WHERE id=?",
    parameters: [{ type: "integer" as const, value: "9007199254740993" }],
  };
  const result = () => ({
    ...scope,
    planDialect: "h2",
    session: {
      sessionId: scope.sessionId,
      autoCommit: false,
      supportsTransactions: true,
      ddlCausesCommit: true,
      statementsSinceBoundary: 1,
    },
    columns: [{ name: "PLAN", typeName: "CHARACTER VARYING" }],
    rows: [["SELECT ..."]],
    updateCount: null,
    rowsTruncated: false,
    elapsedMs: 2,
  });
  it("uses the dedicated command and preserves the attested plan and session", async () => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(result());
    const value = await new TauriJavaDatabaseAdapter().explainSession(scope);
    expect(invoke).toHaveBeenCalledWith("explain_java_database_session", { request: scope });
    expect(value.planDialect).toBe("h2");
    expect(value.session.sessionId).toBe(scope.sessionId);
  });
  it.each([
    { planDialect: undefined },
    { planDialect: "postgresql" },
    { updateCount: 1 },
    { session: { ...result().session, sessionId: "b".repeat(32) } },
    { requestId: "old" },
    { rows: [[null]] },
    { columns: [] },
  ])("refuses unconfirmed, mismatched or malformed plans %o", async (change) => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue({ ...result(), ...change });
    await expect(new TauriJavaDatabaseAdapter().explainSession(scope)).rejects.toThrow();
  });
  it("does not accept an unknown plan dialect in metadata", async () => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue({
      ...scope,
      productName: "H2",
      productVersion: "2.4.240",
      estimatedPlanDialect: "guessed",
      tables: [],
      truncated: false,
      elapsedMs: 1,
      session: result().session,
    });
    await expect(new TauriJavaDatabaseAdapter().inspectSession(scope)).rejects.toThrow();
  });
});
