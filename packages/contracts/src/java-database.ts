export interface JavaDatabaseConnectionInput {
  workspaceId: string;
  generation: number;
  requestId: string;
  jdkHome: string;
  driverJarPath: string;
  jdbcUrl: string;
  username: string;
  password: string;
}

export interface JavaDatabaseColumn {
  name: string;
  typeName: string;
  nullable: boolean;
}

export interface JavaDatabaseTable {
  catalog: string | null;
  schema: string | null;
  name: string;
  tableType: string;
  columns: JavaDatabaseColumn[];
  columnsTruncated: boolean;
}

export interface JavaDatabaseConnectionResult {
  workspaceId: string;
  generation: number;
  requestId: string;
  productName: string;
  productVersion: string;
  /** Native JDBC bridge support; omitted or null means estimated plans are unavailable. */
  estimatedPlanDialect?: "h2" | null;
  /** Driver-reported identifier quoting; absent on older hosts, null when unsupported. */
  identifierQuoteString?: string | null;
  /** Current connection catalog; null when the driver has no catalog information. */
  currentCatalog?: string | null;
  tables: JavaDatabaseTable[];
  truncated: boolean;
  elapsedMs: number;
}

export interface JavaDatabaseQuerySubmission extends JavaDatabaseConnectionInput {
  sql: string;
  /** Absent uses ordinary Statement execution; an array selects PreparedStatement execution. */
  parameters?: JavaDatabaseParameter[];
}

export interface JavaDatabaseQueryColumn {
  name: string;
  typeName: string;
}

export interface JavaDatabaseQueryResult {
  workspaceId: string;
  generation: number;
  requestId: string;
  columns: JavaDatabaseQueryColumn[];
  rows: (string | null)[][];
  updateCount: number | null;
  rowsTruncated: boolean;
  elapsedMs: number;
}

/** Positional JDBC parameters. Numeric and temporal values remain exact text until the JDK binds them. */
export type JavaDatabaseParameterType =
  "string" | "integer" | "decimal" | "boolean" | "null" | "date" | "time" | "timestamp" | "binary";
export interface JavaDatabaseParameter {
  type: JavaDatabaseParameterType;
  value: string;
}

export interface JavaDatabaseSessionState {
  sessionId: string;
  autoCommit: boolean;
  supportsTransactions: boolean;
  ddlCausesCommit: boolean;
  statementsSinceBoundary: number;
}
export interface JavaDatabaseSessionScope {
  workspaceId: string;
  generation: number;
  requestId: string;
  sessionId: string;
}
export type JavaDatabaseTransactionAction =
  "begin" | "commit" | "rollback" | "auto-commit" | "status";
export interface JavaDatabaseSessionConnectionResult extends JavaDatabaseConnectionResult {
  session: JavaDatabaseSessionState;
}
export interface JavaDatabaseSessionQueryRequest extends JavaDatabaseSessionScope {
  sql: string;
  parameters?: JavaDatabaseParameter[];
}
export interface JavaDatabaseSessionQueryResult extends JavaDatabaseQueryResult {
  session: JavaDatabaseSessionState;
}
export interface JavaDatabaseTransactionRequest extends JavaDatabaseSessionScope {
  action: JavaDatabaseTransactionAction;
}
export interface JavaDatabaseTransactionResult extends JavaDatabaseSessionScope {
  session: JavaDatabaseSessionState;
  outcome: "transaction-started" | "committed" | "rolled-back" | "auto-commit-enabled" | "status";
}
export interface JavaDatabaseSessionCloseRequest extends JavaDatabaseSessionScope {
  /** Explicit user consent to discard pending transaction work. */
  allowRollback: boolean;
}
export interface JavaDatabaseSessionCloseResult extends JavaDatabaseSessionScope {
  closed: boolean;
  rollbackConfirmed: boolean;
}

/** Stop closes the owned worker; it cannot attest whether database work committed. */
export type JavaDatabaseCancelRequest = Pick<
  JavaDatabaseSessionScope,
  "workspaceId" | "generation" | "requestId"
> &
  (
    | { sessionId: string; connectionRequestId?: never }
    | { sessionId?: never; connectionRequestId: string }
  );
export type JavaDatabaseCancelResult = JavaDatabaseCancelRequest & {
  stopped: true;
  outcome: "unknown";
};

export type JavaDatabaseResultFormat = "csv" | "json";
export interface JavaDatabaseResultExportRequest {
  workspaceId: string;
  generation: number;
  requestId: string;
  sourceRequestId: string;
  format: JavaDatabaseResultFormat;
  spreadsheetText: boolean;
  allowPartial: boolean;
}
export interface JavaDatabaseResultExport {
  workspaceId: string;
  generation: number;
  requestId: string;
  sourceRequestId: string;
  format: JavaDatabaseResultFormat;
  filePath: string;
  byteLength: number;
  rowCount: number;
  rowsTruncated: boolean;
  spreadsheetText: boolean;
}

/** An estimated plan returned on the existing JDBC connection; never requests ANALYZE. */
export interface JavaDatabaseEstimatedPlanResult extends JavaDatabaseSessionQueryResult {
  planDialect: "h2";
}
