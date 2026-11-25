import type {
  JavaDatabaseConnectionInput,
  JavaDatabaseEstimatedPlanResult,
  JavaDatabaseResultExportRequest,
  JavaDatabaseResultExport,
  JavaDatabaseCancelRequest,
  JavaDatabaseCancelResult,
  JavaDatabaseConnectionResult,
  JavaDatabaseQueryResult,
  JavaDatabaseQuerySubmission,
  JavaDatabaseSessionScope,
  JavaDatabaseSessionState,
  JavaDatabaseSessionQueryRequest,
  JavaDatabaseSessionConnectionResult,
  JavaDatabaseSessionQueryResult,
  JavaDatabaseTransactionRequest,
  JavaDatabaseTransactionResult,
  JavaDatabaseSessionCloseRequest,
  JavaDatabaseSessionCloseResult,
} from "@ide/contracts";
import type { JavaDatabasePort } from "@ide/web-core/ports";
import { invokeTauri } from "./errors";

export const JAVA_DATABASE_INSPECT_COMMAND = "inspect_java_database";
export const JAVA_DATABASE_EXECUTE_COMMAND = "execute_java_database";

type Correlation = Pick<JavaDatabaseSessionScope, "workspaceId" | "generation" | "requestId">;

const MAX_TABLES = 256;
const MAX_COLUMNS = 128;
const MAX_ROWS = 200;
const MAX_CELL_TEXT = 16 * 1024;
const MAX_RESULT_TEXT = 2 * 1024 * 1024;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid database response from the desktop host.");
  }
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function identityMatches(data: Record<string, unknown>, request: Correlation) {
  return (
    data.workspaceId === request.workspaceId &&
    data.generation === request.generation &&
    data.requestId === request.requestId
  );
}

function elapsed(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function normalizeConnectionResult(
  value: unknown,
  request: Correlation,
): JavaDatabaseConnectionResult {
  const data = object(value);
  if (
    !identityMatches(data, request) ||
    !requiredText(data.productName, 256) ||
    typeof data.productVersion !== "string" ||
    data.productVersion.length > 256 ||
    !(
      data.identifierQuoteString === undefined ||
      data.identifierQuoteString === null ||
      requiredText(data.identifierQuoteString, 16)
    ) ||
    !(
      data.currentCatalog === undefined ||
      data.currentCatalog === null ||
      requiredText(data.currentCatalog, 256)
    ) ||
    !(
      data.estimatedPlanDialect === undefined ||
      data.estimatedPlanDialect === null ||
      data.estimatedPlanDialect === "h2"
    ) ||
    !Array.isArray(data.tables) ||
    data.tables.length > MAX_TABLES ||
    typeof data.truncated !== "boolean" ||
    !elapsed(data.elapsedMs)
  ) {
    throw new Error("Uncorrelated or malformed database metadata from the desktop host.");
  }

  let textSize = 0;
  const tables = data.tables.map((entry) => {
    const table = object(entry);
    if (
      (table.catalog !== null && !requiredText(table.catalog, 256)) ||
      (table.schema !== null && !requiredText(table.schema, 256)) ||
      !requiredText(table.name, 512) ||
      !requiredText(table.tableType, 64) ||
      !Array.isArray(table.columns) ||
      table.columns.length > MAX_COLUMNS ||
      typeof table.columnsTruncated !== "boolean"
    ) {
      throw new Error("Malformed database table metadata from the desktop host.");
    }
    const columns = table.columns.map((entry) => {
      const column = object(entry);
      if (
        !requiredText(column.name, 512) ||
        !requiredText(column.typeName, 128) ||
        typeof column.nullable !== "boolean"
      ) {
        throw new Error("Malformed database column metadata from the desktop host.");
      }
      textSize += column.name.length + column.typeName.length;
      if (textSize > MAX_RESULT_TEXT)
        throw new Error("Database metadata exceeds the display limit.");
      return { name: column.name, typeName: column.typeName, nullable: column.nullable };
    });
    textSize += table.name.length + table.tableType.length + (table.schema?.length ?? 0);
    if (textSize > MAX_RESULT_TEXT) throw new Error("Database metadata exceeds the display limit.");
    return {
      catalog: table.catalog as string | null,
      schema: table.schema as string | null,
      name: table.name,
      tableType: table.tableType,
      columns,
      columnsTruncated: table.columnsTruncated,
    };
  });

  return {
    workspaceId: request.workspaceId,
    generation: request.generation,
    requestId: request.requestId,
    productName: data.productName,
    productVersion: data.productVersion,
    ...(data.estimatedPlanDialect !== undefined
      ? { estimatedPlanDialect: data.estimatedPlanDialect as "h2" | null }
      : {}),
    ...(data.identifierQuoteString !== undefined
      ? { identifierQuoteString: data.identifierQuoteString as string | null }
      : {}),
    ...(data.currentCatalog !== undefined
      ? { currentCatalog: data.currentCatalog as string | null }
      : {}),
    tables,
    truncated: data.truncated,
    elapsedMs: data.elapsedMs,
  };
}

function normalizeQueryResult(value: unknown, request: Correlation): JavaDatabaseQueryResult {
  const data = object(value);
  if (
    !identityMatches(data, request) ||
    !Array.isArray(data.columns) ||
    data.columns.length > MAX_COLUMNS ||
    !Array.isArray(data.rows) ||
    data.rows.length > MAX_ROWS ||
    (data.updateCount !== null &&
      (!Number.isSafeInteger(data.updateCount) || (data.updateCount as number) < 0)) ||
    typeof data.rowsTruncated !== "boolean" ||
    !elapsed(data.elapsedMs)
  ) {
    throw new Error("Uncorrelated or malformed SQL result from the desktop host.");
  }

  let textSize = 0;
  const columns = data.columns.map((entry) => {
    const column = object(entry);
    if (!requiredText(column.name, 512) || !requiredText(column.typeName, 128)) {
      throw new Error("Malformed SQL result column from the desktop host.");
    }
    textSize += column.name.length + column.typeName.length;
    return { name: column.name, typeName: column.typeName };
  });
  const rows = data.rows.map((row) => {
    if (!Array.isArray(row) || row.length !== columns.length) {
      throw new Error("Malformed SQL result row from the desktop host.");
    }
    return row.map((cell) => {
      if (cell !== null && (typeof cell !== "string" || cell.length > MAX_CELL_TEXT)) {
        throw new Error("Malformed SQL result value from the desktop host.");
      }
      if (typeof cell === "string") textSize += cell.length;
      if (textSize > MAX_RESULT_TEXT) throw new Error("SQL results exceed the display limit.");
      return cell as string | null;
    });
  });

  return {
    workspaceId: request.workspaceId,
    generation: request.generation,
    requestId: request.requestId,
    columns,
    rows,
    updateCount: data.updateCount as number | null,
    rowsTruncated: data.rowsTruncated,
    elapsedMs: data.elapsedMs,
  };
}

function normalizeSession(value: unknown, expectedId?: string): JavaDatabaseSessionState {
  const data = object(value);
  if (
    typeof data.sessionId !== "string" ||
    !/^[a-f0-9]{32}$/.test(data.sessionId) ||
    (expectedId !== undefined && data.sessionId !== expectedId) ||
    typeof data.autoCommit !== "boolean" ||
    typeof data.supportsTransactions !== "boolean" ||
    typeof data.ddlCausesCommit !== "boolean" ||
    !Number.isSafeInteger(data.statementsSinceBoundary) ||
    (data.statementsSinceBoundary as number) < 0 ||
    (data.statementsSinceBoundary as number) > 1_000_000
  ) {
    throw new Error("Malformed or mismatched JDBC session from the desktop host.");
  }
  return {
    sessionId: data.sessionId,
    autoCommit: data.autoCommit,
    supportsTransactions: data.supportsTransactions,
    ddlCausesCommit: data.ddlCausesCommit,
    statementsSinceBoundary: data.statementsSinceBoundary as number,
  };
}

export class TauriJavaDatabaseAdapter implements JavaDatabasePort {
  async exportResult(
    request: JavaDatabaseResultExportRequest,
  ): Promise<JavaDatabaseResultExport | null> {
    const value = await invokeTauri("export_java_database_result", { request });
    if (value === null) return null;
    const data = object(value);
    if (
      !identityMatches(data, request) ||
      data.sourceRequestId !== request.sourceRequestId ||
      data.format !== request.format ||
      !requiredText(data.filePath, 32768) ||
      new TextEncoder().encode(data.filePath).length > 32768 ||
      /[\u0000-\u001f\u007f]/u.test(data.filePath) ||
      !/^(?:\/|[A-Za-z]:[\\/]|\\\\)/u.test(data.filePath) ||
      !data.filePath.endsWith("." + request.format) ||
      !elapsed(data.byteLength) ||
      (data.byteLength as number) > MAX_RESULT_TEXT ||
      !elapsed(data.rowCount) ||
      (data.rowCount as number) > MAX_ROWS ||
      typeof data.rowsTruncated !== "boolean" ||
      (data.rowsTruncated && !request.allowPartial) ||
      data.spreadsheetText !== (request.format === "csv" && request.spreadsheetText)
    ) {
      throw new Error("Uncorrelated or malformed SQL result export from the desktop host.");
    }
    return {
      ...request,
      filePath: data.filePath,
      byteLength: data.byteLength as number,
      rowCount: data.rowCount as number,
      rowsTruncated: data.rowsTruncated,
      spreadsheetText: data.spreadsheetText as boolean,
    };
  }

  async cancelSession(request: JavaDatabaseCancelRequest): Promise<JavaDatabaseCancelResult> {
    const data = object(await invokeTauri("cancel_java_database_session", { request }));
    if (
      !identityMatches(data, request) ||
      data.sessionId !== request.sessionId ||
      data.connectionRequestId !== request.connectionRequestId ||
      data.stopped !== true ||
      data.outcome !== "unknown"
    ) {
      throw new Error("The desktop host did not confirm that the requested JDBC worker stopped.");
    }
    return { ...request, stopped: true, outcome: "unknown" };
  }

  async connectSession(
    request: JavaDatabaseConnectionInput,
  ): Promise<JavaDatabaseSessionConnectionResult> {
    const data = object(await invokeTauri("connect_java_database_session", { request }));
    return { ...normalizeConnectionResult(data, request), session: normalizeSession(data.session) };
  }

  async inspectSession(
    request: JavaDatabaseSessionScope,
  ): Promise<JavaDatabaseSessionConnectionResult> {
    const data = object(await invokeTauri("inspect_java_database_session", { request }));
    return {
      ...normalizeConnectionResult(data, request),
      session: normalizeSession(data.session, request.sessionId),
    };
  }

  async executeSession(
    request: JavaDatabaseSessionQueryRequest,
  ): Promise<JavaDatabaseSessionQueryResult> {
    const data = object(await invokeTauri("execute_java_database_session", { request }));
    return {
      ...normalizeQueryResult(data, request),
      session: normalizeSession(data.session, request.sessionId),
    };
  }

  async explainSession(
    request: JavaDatabaseSessionQueryRequest,
  ): Promise<JavaDatabaseEstimatedPlanResult> {
    const data = object(await invokeTauri("explain_java_database_session", { request }));
    const result = normalizeQueryResult(data, request);
    if (
      data.planDialect !== "h2" ||
      result.updateCount !== null ||
      result.columns.length !== 1 ||
      result.columns[0].name !== "PLAN" ||
      result.rows.length !== 1 ||
      result.rows[0][0] === null
    ) {
      throw new Error("The desktop host did not return a supported estimated query plan.");
    }
    return {
      ...result,
      session: normalizeSession(data.session, request.sessionId),
      planDialect: "h2",
    };
  }

  async controlSession(
    request: JavaDatabaseTransactionRequest,
  ): Promise<JavaDatabaseTransactionResult> {
    const data = object(await invokeTauri("control_java_database_session", { request }));
    const expected = {
      begin: "transaction-started",
      commit: "committed",
      rollback: "rolled-back",
      "auto-commit": "auto-commit-enabled",
      status: "status",
    } as const;
    if (
      !identityMatches(data, request) ||
      data.sessionId !== request.sessionId ||
      data.outcome !== expected[request.action]
    ) {
      throw new Error("Uncorrelated JDBC transaction result from the desktop host.");
    }
    return {
      ...request,
      session: normalizeSession(data.session, request.sessionId),
      outcome: expected[request.action],
    };
  }

  async closeSession(
    request: JavaDatabaseSessionCloseRequest,
  ): Promise<JavaDatabaseSessionCloseResult> {
    const data = object(await invokeTauri("close_java_database_session", { request }));
    if (
      !identityMatches(data, request) ||
      data.sessionId !== request.sessionId ||
      data.closed !== true ||
      typeof data.rollbackConfirmed !== "boolean"
    ) {
      throw new Error("Unconfirmed JDBC disconnect from the desktop host.");
    }
    return { ...request, closed: true, rollbackConfirmed: data.rollbackConfirmed };
  }

  async inspect(request: JavaDatabaseConnectionInput): Promise<JavaDatabaseConnectionResult> {
    return normalizeConnectionResult(
      await invokeTauri(JAVA_DATABASE_INSPECT_COMMAND, { request }),
      request,
    );
  }

  async execute(request: JavaDatabaseQuerySubmission): Promise<JavaDatabaseQueryResult> {
    return normalizeQueryResult(
      await invokeTauri(JAVA_DATABASE_EXECUTE_COMMAND, { request }),
      request,
    );
  }
}

export { normalizeConnectionResult as normalizeJavaDatabaseConnectionResult };
export { normalizeQueryResult as normalizeJavaDatabaseQueryResult };
