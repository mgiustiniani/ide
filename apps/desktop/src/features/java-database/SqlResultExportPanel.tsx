import { useEffect, useRef, useState } from "react";
import type { JavaDatabaseQueryResult, JavaDatabaseResultFormat } from "@ide/contracts";
import type { JavaDatabasePort } from "@ide/web-core/ports";

interface Props {
  port?: JavaDatabasePort;
  result: JavaDatabaseQueryResult;
  workspaceId: string | null;
  generation: number;
  enabled: boolean;
}

/** Export only the captured result; destination selection belongs to the desktop host. */
export function SqlResultExportPanel(props: Props): JSX.Element {
  const { port, result, workspaceId, generation, enabled } = props;
  const [format, setFormat] = useState<JavaDatabaseResultFormat>("csv");
  const [spreadsheetText, setSpreadsheetText] = useState(true);
  const [allowPartial, setAllowPartial] = useState(false);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const latest = useRef(props);
  latest.current = props;
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const revision = useRef(0);
  useEffect(() => {
    revision.current += 1;
    setStatus(null);
    setError(false);
  }, [port, result, workspaceId, generation, enabled]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; revision.current += 1; };
  }, []);
  const available = Boolean(port?.exportResult && enabled && workspaceId === result.workspaceId &&
    generation === result.generation && result.columns.length > 0);
  async function exportResult() {
    if (!available || inFlight.current || !port?.exportResult || !workspaceId ||
        (result.rowsTruncated && !allowPartial)) return;
    const captured = props;
    const capturedRevision = revision.current;
    const current = () => mounted.current && latest.current.port === port &&
      latest.current.result === result && latest.current.workspaceId === workspaceId &&
      latest.current.generation === generation && latest.current.enabled &&
      revision.current === capturedRevision;
    inFlight.current = true;
    setPending(true); setStatus(null); setError(false);
    const request = { workspaceId, generation, requestId: `sql-export-${crypto.randomUUID()}`,
      sourceRequestId: result.requestId, format, spreadsheetText: format === "csv" && spreadsheetText,
      allowPartial: result.rowsTruncated && allowPartial };
    try {
      const response = await captured.port!.exportResult!(request);
      if (!current()) return;
      if (response === null) { setStatus("SQL result export cancelled."); return; }
      if (response.workspaceId !== workspaceId || response.generation !== generation ||
          response.requestId !== request.requestId || response.sourceRequestId !== result.requestId ||
          response.format !== format || response.rowCount !== result.rows.length ||
          response.rowsTruncated !== result.rowsTruncated || response.spreadsheetText !== request.spreadsheetText ||
          typeof response.filePath !== "string" || !response.filePath ||
          !Number.isSafeInteger(response.byteLength) || response.byteLength < 0 || response.byteLength > 2 * 1024 * 1024) {
        throw new Error("Invalid export response");
      }
      setStatus(`Exported ${response.rowCount} captured rows${response.rowsTruncated ? " (partial result)" : ""} to ${response.filePath}`);
    } catch {
      if (current()) { setError(true); setStatus("SQL result export failed. The destination may already exist or the captured result may have expired. Choose a new filename and retry, or run the query again."); }
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  }
  return <section aria-label="Export SQL result" className="flex flex-col gap-2 border-t border-[var(--border-default)] p-2 text-xs">
    <p>Export the captured rows without running SQL again. Choose a new file (up to 2 MiB).</p>
    <label>Result export format <select aria-label="Result export format" value={format} disabled={pending}
      onChange={(event) => setFormat(event.target.value as JavaDatabaseResultFormat)}>
      <option value="csv">CSV</option><option value="json">JSON</option>
    </select></label>
    {format === "csv" ? <>
      <label><input type="checkbox" checked={spreadsheetText} disabled={pending}
        onChange={(event) => setSpreadsheetText(event.target.checked)} /> Prefix CSV text for spreadsheets</label>
      <p>CSV uses UTF-8, quoted text and CRLF records. NULL is an unquoted empty field; an empty string is quoted.
        The prefix adds an apostrophe to every non-NULL header and value. Spreadsheet imports may reinterpret data or formulas; this is not universal formula protection. Use JSON to preserve exact strings and NULL.</p>
    </> : <p>JSON preserves column order, duplicate labels, exact strings and NULL in row arrays, with column types and partial-result metadata.</p>}
    {result.rowsTruncated ? <label><input type="checkbox" checked={allowPartial} disabled={pending}
      onChange={(event) => setAllowPartial(event.target.checked)} /> Export only these {result.rows.length} captured rows; the result is partial</label> : null}
    <button type="button" disabled={!available || pending || (result.rowsTruncated && !allowPartial)}
      onClick={() => void exportResult()}>{pending ? "Choosing export destination…" : "Export captured result as…"}</button>
    {!port?.exportResult ? <p>Result export requires a desktop host with native Save As support.</p> : null}
    {status ? <p role={error ? "alert" : "status"} aria-label="SQL result export status">{status}</p> : null}
  </section>;
}
