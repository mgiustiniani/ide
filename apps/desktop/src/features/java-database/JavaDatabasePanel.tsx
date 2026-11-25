import type {
  JavaDatabaseConnectionResult,
  JavaDatabaseEstimatedPlanResult,
  JavaDatabaseQueryResult,
  JavaDatabaseParameter,
  JavaDatabaseParameterType,
  JavaDatabaseSessionState,
  JavaDatabaseTransactionAction,
} from "@ide/contracts";
import type { JavaDatabasePort } from "@ide/web-core/ports";
import { SqlResultExportPanel } from "./SqlResultExportPanel";
import { useEffect, useRef, useState } from "react";
import type { JavaDatabaseConnectionDraft } from "./useJavaDatabaseController";
import { SqlSchemaSuggestionsDialog } from "./SqlSchemaSuggestionsDialog";
import { insertSqlSchemaSuggestion, type SqlSchemaSuggestion } from "./sqlSchemaSuggestions";

interface JavaDatabasePanelProps {
  resultExportPort?: JavaDatabasePort;
  canExplain?: boolean;
  onExplain?(sql: string, parameters?: JavaDatabaseParameter[]): Promise<void>;
  busy:
    "connect" | "refresh" | "query" | "transaction" | "disconnect" | "workspace" | "cancel" | null;
  session?: JavaDatabaseSessionState | null;
  notice?: string | null;
  sessionCapable?: boolean;
  canCancel?: boolean;
  preserveQueryDraft?: boolean;
  preserveConnectionDraft?: boolean;
  onCancel?(): Promise<void>;
  onTransaction?(action: JavaDatabaseTransactionAction): Promise<void>;
  connection: JavaDatabaseConnectionResult | null;
  error: string | null;
  jdkHome: string;
  queryResult: JavaDatabaseQueryResult | JavaDatabaseEstimatedPlanResult | null;
  workspaceAvailable: boolean;
  workspaceId: string | null;
  generation: number;
  onConnect(draft: JavaDatabaseConnectionDraft): Promise<void>;
  onDisconnect(): void;
  onExecute(sql: string, parameters?: JavaDatabaseParameter[]): Promise<void>;
  onRefreshSchema(): Promise<void>;
}

export function JavaDatabasePanel({
  busy,
  resultExportPort,
  connection,
  error,
  jdkHome,
  queryResult,
  workspaceAvailable,
  workspaceId,
  generation,
  session,
  notice,
  sessionCapable,
  canCancel = false,
  preserveQueryDraft = false,
  preserveConnectionDraft = false,
  onCancel,
  onTransaction,
  onConnect,
  onDisconnect,
  onExecute,
  canExplain = false,
  onExplain,
  onRefreshSchema,
}: JavaDatabasePanelProps): JSX.Element {
  const [driverJarPath, setDriverJarPath] = useState("");
  const [jdbcUrl, setJdbcUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [sql, setSql] = useState("SELECT 1");
  const [trusted, setTrusted] = useState(false);
  const [useParameters, setUseParameters] = useState(false);
  const [parameters, setParameters] = useState<JavaDatabaseParameter[]>([]);
  const sqlInput = useRef<HTMLTextAreaElement>(null);
  const [suggestions, setSuggestions] = useState<{
    metadata: JavaDatabaseConnectionResult;
    sql: string;
    start: number;
    end: number;
    workspaceId: string | null;
    generation: number;
  } | null>(null);
  const [insertionError, setInsertionError] = useState<string | null>(null);
  const latest = useRef({ connection, workspaceId, generation, sql, busy, workspaceAvailable });
  latest.current = { connection, workspaceId, generation, sql, busy, workspaceAvailable };
  useEffect(() => {
    setSuggestions(null);
    setInsertionError(null);
  }, [connection, workspaceId, generation, busy]);
  const matches = (capture: NonNullable<typeof suggestions>) => {
    const now = latest.current;
    return (
      now.workspaceAvailable &&
      !now.busy &&
      now.connection === capture.metadata &&
      now.workspaceId === capture.workspaceId &&
      now.generation === capture.generation &&
      now.sql === capture.sql
    );
  };
  const openSuggestions = () => {
    if (!connection || busy || !workspaceAvailable || !sqlInput.current) return;
    setInsertionError(null);
    setSuggestions({
      metadata: connection,
      sql,
      start: sqlInput.current.selectionStart,
      end: sqlInput.current.selectionEnd,
      workspaceId,
      generation,
    });
  };
  const restoreFocus = (
    capture: NonNullable<typeof suggestions>,
    text: string,
    start: number,
    end: number,
  ) => {
    setTimeout(() => {
      const now = latest.current,
        input = sqlInput.current;
      if (
        !input ||
        !now.workspaceAvailable ||
        now.busy ||
        now.connection !== capture.metadata ||
        now.workspaceId !== capture.workspaceId ||
        now.generation !== capture.generation ||
        input.value !== text
      )
        return;
      input.focus();
      input.setSelectionRange(start, end);
    }, 0);
  };
  const insertSuggestion = (item: SqlSchemaSuggestion) => {
    const capture = suggestions;
    if (!capture || !matches(capture)) return;
    const replacement = insertSqlSchemaSuggestion(
      capture.sql,
      capture.start,
      capture.end,
      item.insertText,
    );
    if (!replacement) {
      setInsertionError(
        "The identifier cannot fit within the SQL console limit. Shorten the statement and try again.",
      );
      return;
    }
    setSql(replacement.text);
    setSuggestions(null);
    restoreFocus(capture, replacement.text, replacement.caret, replacement.caret);
  };

  useEffect(() => {
    setDriverJarPath("");
    setJdbcUrl("");
    setUsername("");
    setPassword("");
    setSql("SELECT 1");
    setTrusted(false);
    setUseParameters(false);
    setParameters([]);
  }, [workspaceId]);

  useEffect(() => {
    if (connection || preserveConnectionDraft) return;
    setDriverJarPath("");
    setJdbcUrl("");
    setUsername("");
    setPassword("");
    setTrusted(false);
    if (!preserveQueryDraft) {
      setSql("SELECT 1");
      setUseParameters(false);
      setParameters([]);
    }
  }, [connection, preserveQueryDraft, preserveConnectionDraft]);

  function updateParameter(index: number, patch: Partial<JavaDatabaseParameter>) {
    setParameters((current) =>
      current.map((parameter, position) =>
        position === index ? { ...parameter, ...patch } : parameter,
      ),
    );
  }

  const connected = connection !== null;
  const disabled = !workspaceAvailable || busy !== null || connected;
  const inputClass =
    "w-full rounded border border-[var(--border-default)] bg-[var(--surface-primary)] px-2 py-1 text-sm text-[var(--text-primary)]";
  const buttonClass =
    "rounded border border-[var(--border-default)] px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <section
      aria-label="Java database"
      className="flex h-full min-h-0 flex-col gap-3 overflow-auto p-3 text-sm"
    >
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold text-[var(--text-primary)]">Java Database</h2>
          <p className="text-xs text-[var(--text-secondary)]">
            JDBC connection, schema inspection and explicit SQL execution.
          </p>
        </div>
        <span className="text-xs text-[var(--text-secondary)]">200 rows · 30 s timeout</span>
      </header>

      <div className="grid shrink-0 grid-cols-1 gap-2 lg:grid-cols-2">
        <label className="text-xs text-[var(--text-secondary)]">
          Workspace JDBC driver JAR
          <input
            aria-label="JDBC driver JAR"
            className={inputClass}
            disabled={disabled}
            placeholder="drivers/postgresql.jar"
            value={driverJarPath}
            onChange={(event) => setDriverJarPath(event.currentTarget.value)}
          />
        </label>
        <label className="text-xs text-[var(--text-secondary)]">
          JDBC URL
          <input
            aria-label="JDBC URL"
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            className={inputClass}
            disabled={disabled}
            placeholder="jdbc:postgresql://localhost:5432/app"
            spellCheck={false}
            value={jdbcUrl}
            onChange={(event) => setJdbcUrl(event.currentTarget.value)}
          />
        </label>
        <label className="text-xs text-[var(--text-secondary)]">
          Username
          <input
            aria-label="Database username"
            autoCapitalize="off"
            autoComplete="username"
            autoCorrect="off"
            className={inputClass}
            disabled={disabled}
            value={username}
            onChange={(event) => setUsername(event.currentTarget.value)}
          />
        </label>
        <label className="text-xs text-[var(--text-secondary)]">
          Password
          <input
            aria-label="Database password"
            autoComplete="current-password"
            className={inputClass}
            disabled={disabled}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
        <span>JDK: {jdkHome || "JDK selected on PATH"}</span>
        <label className="flex items-center gap-2">
          <input
            aria-label="Trust JDBC driver and database operations"
            checked={trusted}
            disabled={busy !== null || connected || !workspaceAvailable}
            type="checkbox"
            onChange={(event) => setTrusted(event.currentTarget.checked)}
          />
          I trust this driver and understand SQL can change database contents.
        </label>
      </div>
      <p className="text-xs text-[var(--text-secondary)]">
        JDBC drivers are Java code and run with your account's privileges. Credentials and
        connection drafts stay in memory and are cleared when you disconnect or switch workspaces.
      </p>

      <div className="flex flex-wrap gap-2">
        {!connected ? (
          <button
            type="button"
            className={buttonClass}
            disabled={
              !workspaceAvailable ||
              busy !== null ||
              !trusted ||
              !driverJarPath.trim() ||
              !jdbcUrl.trim()
            }
            onClick={() =>
              void onConnect({
                driverJarPath: driverJarPath.trim(),
                jdbcUrl: jdbcUrl.trim(),
                username,
                password,
              })
            }
          >
            {busy === "connect" ? "Connecting…" : "Connect and inspect schema"}
          </button>
        ) : (
          <>
            <button
              type="button"
              className={buttonClass}
              disabled={busy !== null}
              onClick={() => void onRefreshSchema()}
            >
              {busy === "refresh" ? "Refreshing…" : "Refresh schema"}
            </button>
            <button
              type="button"
              className={buttonClass}
              disabled={busy !== null}
              onClick={() => void onDisconnect()}
            >
              {session && !session.autoCommit ? "Rollback and disconnect" : "Disconnect"}
            </button>
          </>
        )}
      </div>

      {session ? (
        <section
          aria-label="Database transaction"
          className="flex shrink-0 flex-col gap-2 rounded border border-[var(--border-default)] p-2"
        >
          <p>{session.autoCommit ? "Auto-commit on" : "Auto-commit off"}</p>
          {!session.autoCommit ? (
            <p className="text-xs text-[var(--text-secondary)]">
              Submitted statements since the last commit or rollback:{" "}
              {session.statementsSinceBoundary}. This counts attempts, including reads and failed
              statements; it does not measure changed rows.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {session.autoCommit ? (
              <button
                type="button"
                className={buttonClass}
                disabled={busy !== null || !session.supportsTransactions}
                onClick={() => void onTransaction?.("begin")}
              >
                Begin transaction
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={busy !== null}
                  onClick={() => void onTransaction?.("commit")}
                >
                  Commit
                </button>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={busy !== null}
                  onClick={() => void onTransaction?.("rollback")}
                >
                  Rollback
                </button>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={busy !== null || session.statementsSinceBoundary > 0}
                  onClick={() => void onTransaction?.("auto-commit")}
                >
                  Enable auto-commit
                </button>
              </>
            )}
          </div>
          {!session.supportsTransactions ? <p>This driver does not support transactions.</p> : null}
          {!session.autoCommit && session.statementsSinceBoundary > 0 ? (
            <p className="text-xs">
              Commit or roll back before enabling auto-commit, closing the IDE, or switching
              workspaces. Rollback and disconnect explicitly discards pending work.
            </p>
          ) : null}
          {session.ddlCausesCommit ? (
            <p className="text-xs">
              This database may commit the transaction automatically when schema changes are
              executed.
            </p>
          ) : null}
        </section>
      ) : connected && !sessionCapable ? (
        <p className="text-xs">
          This host uses a separate connection per operation; persistent sessions and transaction
          controls are unavailable.
        </p>
      ) : null}
      {notice ? (
        <p role="status" aria-label="Database transaction outcome">
          {notice}
        </p>
      ) : null}
      {canCancel || busy === "cancel" ? (
        <div className="flex shrink-0 flex-col gap-1">
          <button
            type="button"
            className={buttonClass + " self-start"}
            disabled={!canCancel}
            onClick={() => void onCancel?.()}
          >
            {busy === "cancel" ? "Stopping…" : "Stop and disconnect"}
          </button>
          <p className="text-xs text-[var(--text-secondary)]">
            Stop closes the JDBC worker and connection. A commit or rollback may not be confirmed;
            check database state before retrying. SQL and parameters remain in memory for review. If
            normal shutdown fails, the worker is forcibly terminated; recent writes may be lost
            according to the database's durability settings.
          </p>
        </div>
      ) : null}
      {!workspaceAvailable ? (
        <p className="text-xs text-[var(--text-secondary)]">
          Open a workspace to use database tools.
        </p>
      ) : null}
      {error ? (
        <p role="alert" aria-label="Database error" className="text-xs text-[var(--text-danger)]">
          {error}
        </p>
      ) : null}

      {connection ? (
        <section aria-label="Database schema" className="flex shrink-0 flex-col gap-2">
          <div className="rounded border border-[var(--border-default)] p-2">
            <h3 className="font-medium">
              {connection.productName} {connection.productVersion}
            </h3>
            <p className="text-xs text-[var(--text-secondary)]">
              {connection.tables.length} tables or views
              {connection.truncated ? " · schema list truncated" : ""}
            </p>
          </div>
          <div className="max-h-52 overflow-auto rounded border border-[var(--border-default)]">
            {connection.tables.length === 0 ? (
              <p className="p-2 text-xs text-[var(--text-secondary)]">
                No user tables or views were found.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border-default)]">
                {connection.tables.map((table) => (
                  <li
                    key={(table.catalog ?? "") + ":" + (table.schema ?? "") + ":" + table.name}
                    className="p-2"
                  >
                    <div className="font-mono text-xs">
                      {[table.schema, table.name].filter(Boolean).join(".")}
                      <span className="ml-2 text-[var(--text-secondary)]">{table.tableType}</span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">
                      {table.columns
                        .map(
                          (column) =>
                            column.name +
                            " " +
                            column.typeName +
                            (column.nullable ? "" : " NOT NULL"),
                        )
                        .join(" · ")}
                      {table.columnsTruncated ? " · columns truncated" : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      ) : null}

      <section aria-label="SQL console" className="flex shrink-0 flex-col gap-2">
        <label className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
          SQL statement
          <textarea
            ref={sqlInput}
            aria-label="SQL statement"
            className="mt-1 min-h-28 w-full resize-y rounded border border-[var(--border-default)] bg-[var(--surface-editor)] p-2 font-mono text-sm text-[var(--text-primary)]"
            disabled={!connected || busy !== null}
            maxLength={64 * 1024}
            spellCheck={false}
            value={sql}
            onChange={(event) => {
              setSql(event.currentTarget.value);
              setSuggestions(null);
              setInsertionError(null);
            }}
            onKeyDown={(event) => {
              if (
                event.ctrlKey &&
                !event.metaKey &&
                !event.altKey &&
                (event.code === "Space" || event.key === " ")
              ) {
                event.preventDefault();
                event.stopPropagation();
                openSuggestions();
              }
            }}
          />
        </label>
        <button
          type="button"
          className={buttonClass + " self-start"}
          disabled={!connected || busy !== null || !workspaceAvailable}
          onClick={openSuggestions}
        >
          Schema suggestions
        </button>
        <p className="text-xs text-[var(--text-secondary)]">
          Ctrl+Space inserts table or column names from the last schema inspection. Review the SQL
          before running it.
        </p>
        {insertionError ? <p role="alert">{insertionError}</p> : null}
        {suggestions && matches(suggestions) ? (
          <SqlSchemaSuggestionsDialog
            metadata={suggestions.metadata}
            onSelect={insertSuggestion}
            onClose={() => {
              const capture = suggestions;
              setSuggestions(null);
              if (matches(capture)) restoreFocus(capture, capture.sql, capture.start, capture.end);
            }}
          />
        ) : null}
        <label className="flex shrink-0 items-center gap-2 text-xs">
          <input
            aria-label="Use bound SQL parameters"
            type="checkbox"
            checked={useParameters}
            disabled={!connected || busy !== null}
            onChange={(event) => setUseParameters(event.currentTarget.checked)}
          />
          Use bound parameters for ? placeholders
        </label>
        {useParameters ? (
          <section aria-label="SQL parameters" className="flex shrink-0 flex-col gap-2">
            <p className="text-xs text-[var(--text-secondary)]">
              Parameters are bound in order by the JDBC driver. Numeric values stay exact text;
              dates use YYYY-MM-DD, times HH:mm:ss and timestamps YYYY-MM-DDTHH:mm:ss. Binary values
              use base64. Values are not inserted into the SQL text.
            </p>
            <div className="flex max-h-52 flex-col gap-2 overflow-auto">
              {parameters.map((parameter, index) => (
                <div key={index} className="flex flex-wrap items-center gap-2">
                  <span className="text-xs">{index + 1}</span>
                  <select
                    aria-label={`SQL parameter ${index + 1} type`}
                    className={inputClass + " !w-auto"}
                    value={parameter.type}
                    disabled={busy !== null}
                    onChange={(event) => {
                      const type = event.currentTarget.value as JavaDatabaseParameterType;
                      updateParameter(index, { type, ...(type === "null" ? { value: "" } : {}) });
                    }}
                  >
                    {(
                      [
                        "string",
                        "integer",
                        "decimal",
                        "boolean",
                        "null",
                        "date",
                        "time",
                        "timestamp",
                        "binary",
                      ] as const
                    ).map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label={`SQL parameter ${index + 1} value`}
                    className={inputClass + " min-w-32 flex-1"}
                    value={parameter.value}
                    maxLength={16 * 1024}
                    disabled={busy !== null || parameter.type === "null"}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={
                      parameter.type === "null"
                        ? "NULL"
                        : parameter.type === "boolean"
                          ? "true or false"
                          : "Parameter value"
                    }
                    onChange={(event) =>
                      updateParameter(index, { value: event.currentTarget.value })
                    }
                  />
                  <button
                    type="button"
                    aria-label={`Remove SQL parameter ${index + 1}`}
                    className={buttonClass}
                    disabled={busy !== null}
                    onClick={() =>
                      setParameters((current) =>
                        current.filter((_, position) => position !== index),
                      )
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className={buttonClass + " self-start"}
              disabled={!connected || busy !== null || parameters.length >= 256}
              onClick={() =>
                setParameters((current) => [...current, { type: "string", value: "" }])
              }
            >
              Add SQL parameter
            </button>
          </section>
        ) : null}
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={buttonClass}
            disabled={!connected || busy !== null || !trusted || !sql.trim()}
            onClick={() => void onExecute(sql, useParameters ? parameters : undefined)}
          >
            {busy === "query" ? "Running…" : "Run SQL"}
          </button>
          <button
            type="button"
            className={buttonClass}
            disabled={
              !connected || busy !== null || !trusted || !sql.trim() || !canExplain || !onExplain
            }
            title={
              canExplain
                ? "Request an estimated plan for one statement without ANALYZE."
                : "Estimated plans are unavailable for this connection."
            }
            onClick={() => void onExplain?.(sql, useParameters ? parameters : undefined)}
          >
            Estimate plan
          </button>
          <span className="text-xs text-[var(--text-secondary)]">
            Queries may read or change data. Review the statement before running it.
          </span>
        </div>
        {queryResult ? (
          <div
            aria-label="SQL result"
            data-request-id={queryResult.requestId}
            className="min-h-0 overflow-auto rounded border border-[var(--border-default)]"
          >
            {"planDialect" in queryResult && queryResult.planDialect === "h2" ? (
              <section aria-label="Estimated SQL plan" className="p-2">
                <h3>Estimated query plan · H2</h3>
                <p className="text-xs text-[var(--text-secondary)]">
                  Database estimate, without ANALYZE. Planning behavior depends on the driver and
                  server.
                </p>
                <pre className="whitespace-pre-wrap break-words text-xs">
                  {queryResult.rows[0]?.[0]}
                </pre>
              </section>
            ) : queryResult.columns.length === 0 ? (
              <p className="p-2">
                {queryResult.updateCount === null
                  ? "Statement completed."
                  : "Rows affected: " + queryResult.updateCount + "."}
              </p>
            ) : (
              <table aria-label="SQL results" className="w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 bg-[var(--surface-primary)]">
                  <tr>
                    {queryResult.columns.map((column, index) => (
                      <th
                        key={String(index) + ":" + column.name}
                        className="border-b border-[var(--border-default)] p-2"
                      >
                        <span>{column.name}</span>
                        <span className="ml-1 font-normal text-[var(--text-secondary)]">
                          {column.typeName}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {queryResult.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((value, columnIndex) => (
                        <td
                          key={String(rowIndex) + ":" + columnIndex}
                          className="max-w-96 border-b border-[var(--border-default)] p-2 align-top font-mono"
                        >
                          <span className="block max-h-24 overflow-auto whitespace-pre-wrap break-all">
                            {value ?? "NULL"}
                          </span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {queryResult.columns.length > 0 ? (
              <SqlResultExportPanel
                key={JSON.stringify([workspaceId, generation, queryResult.requestId])}
                port={resultExportPort}
                result={queryResult}
                workspaceId={workspaceId}
                generation={generation}
                enabled={workspaceAvailable && busy === null}
              />
            ) : null}
            {queryResult.rowsTruncated ? (
              <p className="p-2 text-xs text-[var(--text-secondary)]">
                Results are limited to 200 rows or 250,000 characters.
              </p>
            ) : null}
          </div>
        ) : null}
      </section>
    </section>
  );
}
