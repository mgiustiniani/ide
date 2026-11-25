import { useEffect, useRef, useState } from "react";
import { useBoundedTextFileImport } from "../files/useBoundedTextFileImport";
import type { useHttpClientLibrary } from "./useHttpClientLibrary";
import {
  exportHttpCollections,
  reviewHttpCollectionImport,
  type HttpImportConflictPolicy,
} from "./httpCollectionTransfer";

const filePolicy = {
  maximumBytes: 2 * 1024 * 1024,
  tooLarge: "HTTP collection files are limited to 2 MiB.",
  readFailure: "The HTTP collection file could not be read. The import text is retained.",
  invalidEncoding: "The HTTP collection file must contain UTF-8 text. The import text is retained.",
};
type Collections = ReturnType<typeof useHttpClientLibrary>;
interface Props {
  collections: Collections;
  workspaceId: string | null;
  generation: number;
}
type Review = ReturnType<typeof reviewHttpCollectionImport> & { revision: string; source: string };
const fieldClass =
  "w-full rounded border border-[var(--border-default)] bg-[var(--surface-primary)] p-1 text-xs";
const buttonClass =
  "rounded border border-[var(--border-default)] px-2 py-1 text-xs disabled:opacity-50";

export function HttpCollectionTransfer({ collections, workspaceId, generation }: Props) {
  const [exportPath, setExportPath] = useState("http-collections.json");
  const [exportPending, setExportPending] = useState(false);
  const exportInFlight = useRef(false);
  const [source, setSource] = useState("");
  const [policy, setPolicy] = useState<HttpImportConflictPolicy>("keep");
  const [review, setReview] = useState<Review | null>(null);
  const [exported, setExported] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true),
    importing = useRef(false);
  const current = useRef({ collections, workspaceId, generation, source, policy, review });
  current.current = { collections, workspaceId, generation, source, policy, review };
  const isCurrent = () =>
    alive.current &&
    current.current.workspaceId === workspaceId &&
    current.current.generation === generation;
  const disabled =
    !workspaceId || !collections.available || collections.busy || !collections.revision;
  const fileImport = useBoundedTextFileImport({
    workspaceId,
    generation,
    enabled: !disabled,
    policy: filePolicy,
    onLoaded: (text) => {
      setSource(text);
      setReview(null);
      setStatus(null);
      setError(null);
    },
  });
  const validReview =
    !!review &&
    review.source === source &&
    review.policy === policy &&
    review.revision === collections.revision;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function confirmImport() {
    if (
      !isCurrent() ||
      importing.current ||
      fileImport.pending ||
      disabled ||
      !review ||
      !validReview ||
      current.current.collections.revision !== review.revision ||
      current.current.review !== review ||
      current.current.source !== source ||
      current.current.policy !== policy
    )
      return;
    importing.current = true;
    setError(null);
    setStatus(null);
    try {
      const result = await collections.save(review.library);
      if (!isCurrent()) return;
      if (result) {
        setReview(null);
        setStatus(
          "HTTP collections imported. The request draft and environment selection were kept; no request was sent.",
        );
      }
    } catch {
      if (isCurrent()) setError("Could not import HTTP collections. Reload and review again.");
    } finally {
      importing.current = false;
    }
  }
  async function exportFile(saveAs = false) {
    if (
      !isCurrent() ||
      disabled ||
      exportInFlight.current ||
      (saveAs ? !collections.exportAs : !collections.exportFile || !exportPath.trim())
    )
      return;
    exportInFlight.current = true;
    setExportPending(true);
    setError(null);
    setStatus(null);
    try {
      const result = saveAs
        ? await collections.exportAs!()
        : await collections.exportFile!(exportPath.trim());
      if (isCurrent() && result === null)
        setStatus("Collection export cancelled. No file was created.");
      if (isCurrent() && result)
        setStatus(`HTTP collections exported to ${result.filePath} (${result.byteLength} bytes).`);
    } catch (error) {
      if (isCurrent())
        setError(error instanceof Error ? error.message : "Could not export HTTP collections.");
    } finally {
      exportInFlight.current = false;
      if (isCurrent()) setExportPending(false);
    }
  }
  return (
    <details>
      <summary className="cursor-pointer text-xs">Import and export collections</summary>
      <div className="mt-2 flex flex-col gap-2">
        <p className="text-xs">
          Transfer this IDE’s version 1 JSON format by loading a file or copying and pasting. Export
          includes saved headers, bodies and environment values in plain text; review credentials
          before sharing. Responses and the current unsaved request are excluded.
        </p>
        <button
          type="button"
          className={buttonClass}
          disabled={disabled}
          onClick={() => {
            if (!isCurrent()) return;
            try {
              setExported(exportHttpCollections(current.current.collections.library));
              setError(null);
            } catch {
              setError("Could not export HTTP collections. Reload and retry.");
            }
          }}
        >
          Export collections JSON
        </button>
        {exported && (
          <label className="text-xs">
            Exported HTTP collections JSON
            <textarea
              className={`${fieldClass} min-h-24 font-mono`}
              readOnly
              value={exported}
              spellCheck={false}
            />
          </label>
        )}
        <label className="text-xs">
          New collection export path
          <input
            className={fieldClass}
            value={exportPath}
            maxLength={1024}
            disabled={exportPending}
            onChange={(event) => {
              setExportPath(event.target.value);
              setStatus(null);
            }}
          />
        </label>
        <p className="text-xs">
          Export creates a new .json file inside this workspace. The parent directory must exist;
          existing files are refused. Saved environment values and headers are included as plain
          text.
        </p>
        <button
          type="button"
          className={buttonClass}
          disabled={disabled || exportPending || !collections.exportFile || !exportPath.trim()}
          onClick={() => {
            void exportFile();
          }}
        >
          Export new collection file
        </button>
        <p className="text-xs">
          Use the native save dialog to choose a new .json file in another directory. Existing files
          are refused; Cancel creates nothing.
        </p>
        <button
          type="button"
          className={buttonClass}
          disabled={disabled || exportPending || !collections.exportAs}
          onClick={() => {
            void exportFile(true);
          }}
        >
          Export collections as…
        </button>
        {exportPending && (
          <p role="status" className="text-xs">
            Exporting HTTP collection file…
          </p>
        )}
        <label className="text-xs">
          Load HTTP collections file
          <input
            type="file"
            aria-label="Load HTTP collections file"
            accept=".json,application/json"
            disabled={disabled}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (!file) return;
              setReview(null);
              setStatus(null);
              setError(null);
              fileImport.importFile(file);
            }}
          />
        </label>
        {fileImport.pending && (
          <div className="text-xs">
            <p role="status">Reading HTTP collection file…</p>
            <button type="button" className={buttonClass} onClick={fileImport.cancel}>
              Cancel collection file read
            </button>
          </div>
        )}
        {fileImport.fileName && (
          <p role="status" className="text-xs">
            Loaded collection file: {fileImport.fileName}. Review the import before saving.
          </p>
        )}
        {fileImport.error && (
          <p role="alert" aria-label="HTTP collection file error" className="text-xs">
            {fileImport.error}
          </p>
        )}
        <label className="text-xs">
          HTTP collections JSON to import
          <textarea
            className={`${fieldClass} min-h-24 font-mono`}
            value={source}
            spellCheck={false}
            disabled={collections.busy}
            maxLength={2 * 1024 * 1024}
            onCompositionStart={() => {
              fileImport.cancel();
              setReview(null);
            }}
            onChange={(event) => {
              fileImport.cancel();
              setSource(event.target.value);
              setReview(null);
              setStatus(null);
              setError(null);
            }}
          />
        </label>
        <label className="text-xs">
          Matching saved names
          <select
            className={fieldClass}
            value={policy}
            disabled={collections.busy}
            onChange={(event) => {
              setPolicy(event.target.value as HttpImportConflictPolicy);
              setReview(null);
              setStatus(null);
            }}
          >
            <option value="keep">Keep saved entries</option>
            <option value="replace">Replace matching entries</option>
          </select>
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            className={buttonClass}
            disabled={disabled || fileImport.pending || !source.trim()}
            onClick={() => {
              if (!isCurrent()) return;
              setReview(null);
              setStatus(null);
              setError(null);
              try {
                const latest = current.current.collections;
                if (!latest.revision || latest.busy) return;
                setReview({
                  ...reviewHttpCollectionImport(source, latest.library, policy),
                  revision: latest.revision,
                  source,
                });
              } catch (error) {
                setError(error instanceof Error ? error.message : "Invalid HTTP collections.");
              }
            }}
          >
            Review collection import
          </button>
          <button
            type="button"
            className={buttonClass}
            disabled={disabled || fileImport.pending || !validReview}
            onClick={() => {
              void confirmImport();
            }}
          >
            Import reviewed collections
          </button>
        </div>
        {review && (
          <div aria-label="HTTP collection import review" className="text-xs">
            <p>
              {review.addedRequests} new requests; {review.addedEnvironments} new environments.
            </p>
            <p>
              {review.matchingRequests} matching requests and {review.matchingEnvironments} matching
              environments will be{" "}
              {review.policy === "keep"
                ? "kept from saved collections"
                : "replaced by imported entries"}
              . Request identity is collection plus name; environment identity is name. Other saved
              entries are retained.
            </p>
            {!validReview && (
              <p role="status">Saved collections changed. Review the import again.</p>
            )}
          </div>
        )}
        {status && (
          <p role="status" className="text-xs">
            {status}
          </p>
        )}
        {error && (
          <p role="alert" aria-label="HTTP collection transfer error" className="text-xs">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
