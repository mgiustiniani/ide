import { useMemo, useRef, useState } from "react";
import type { HttpEnvironment } from "@ide/contracts";
import type { HttpRequestDraft } from "./HttpClientPanel";
import { parseHttpRequestFile, prepareHttpFileRequest, type HttpFileDocument, type HttpRequestSource } from "./httpRequestFile";

interface Props {
  document: HttpFileDocument | null;
  getActiveDocument?(): HttpFileDocument | null;
  workspaceId: string | null;
  generation: number;
  busy: boolean;
  environment?: HttpEnvironment;
  supportsExplicitHttp11: boolean;
  onSend(draft: HttpRequestDraft, environment?: HttpEnvironment, source?: HttpRequestSource): void;
}

export function HttpFileRequests(props: Props): JSX.Element {
  const { document, workspaceId, generation, busy, environment, supportsExplicitHttp11 } = props;
  const latest = useRef(props); latest.current = props;
  const [choice, setChoice] = useState<{ workspaceId: string; generation: number; document: HttpFileDocument; index: number } | null>(null);
  const environmentSignature = JSON.stringify(environment ?? null);
  const documentPath = document?.path;
  const documentText = document?.text;
  const parsed = useMemo(() => {
    if (documentText === undefined) return null;
    try { return { file: parseHttpRequestFile(documentText), error: null }; }
    catch (error) { return { file: null, error: error instanceof Error ? error.message : "The HTTP file is invalid." }; }
  }, [documentText]);
  const currentChoice = choice && workspaceId === choice.workspaceId && generation === choice.generation &&
    document?.path === choice.document.path && document.text === choice.document.text ? choice : null;
  const entry = currentChoice ? parsed?.file?.requests[currentChoice.index] : undefined;
  const prepared = useMemo(() => {
    if (!parsed?.file || !entry) return null;
    try {
      if (entry.draft?.httpVersion && !supportsExplicitHttp11) throw new Error("This HTTP backend cannot honor an explicit HTTP/1.1 version.");
      return { request: prepareHttpFileRequest(parsed.file, entry, environment), error: null };
    } catch (error) { return { request: null, error: error instanceof Error ? error.message : "The file request is unavailable." }; }
  }, [parsed, entry, environment, supportsExplicitHttp11]);
  return <details className="shrink-0 rounded border border-[var(--border-default)] p-2">
    <summary className="cursor-pointer text-xs font-semibold">Requests from editor</summary>
    <div className="mt-2 space-y-2 text-xs">
      <p>{document ? `Active HTTP file: ${document.path}` : "Open a .http or .rest file in the editor to review its requests."}</p>
      {parsed?.error && <p role="alert" aria-label="HTTP file error">{parsed.error}</p>}
      {parsed?.file && <>
        <label className="block">File request
          <select aria-label="HTTP file request" value={currentChoice?.index ?? ""} disabled={!workspaceId || busy}
            className="ml-2 rounded border border-[var(--border-default)]"
            onChange={event => {
              const index = Number(event.target.value);
              if (!document || !workspaceId || event.target.value === "" || !parsed.file?.requests[index]) setChoice(null);
              else setChoice({ workspaceId, generation, document: { ...document }, index });
            }}>
            <option value="">Choose a request</option>
            {parsed.file.requests.map((request, index) => <option key={index} value={index}>
              {request.name} · line {request.line}{request.error ? " · unavailable" : ""}
            </option>)}
          </select>
        </label>
        {!parsed.file.requests.length && <p>No HTTP requests found in this document.</p>}
      </>}
      {prepared?.error && <p role="alert" aria-label="HTTP file request error">{prepared.error}</p>}
      {prepared?.request && <section aria-label="HTTP file request preview" className="space-y-1">
        <p className="break-all">{prepared.request.preview.method} {prepared.request.preview.url}</p>
        {prepared.request.preview.httpVersion && <p>{prepared.request.preview.httpVersion}</p>}
        <pre className="whitespace-pre-wrap break-all">{prepared.request.preview.headers.map(header => `${header.name}: ${header.value}`).join("\n")}</pre>
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all">{prepared.request.preview.body}</pre>
        <p>Uses the current editor buffer. Sending preserves the buffer and saved file.</p>
      </section>}
      <button type="button" disabled={!workspaceId || !entry || !prepared?.request || busy}
        className="rounded border border-[var(--border-default)] px-2 py-1 disabled:opacity-50"
        onClick={() => {
          const live = latest.current;
          const active = live.getActiveDocument ? live.getActiveDocument() : live.document;
          if (!document || !live.document || !active || !entry || !prepared?.request || live.busy || !workspaceId ||
            live.workspaceId !== workspaceId || live.generation !== generation ||
            live.document?.path !== documentPath || live.document.text !== documentText ||
            active?.path !== documentPath || active.text !== documentText ||
            JSON.stringify(live.environment ?? null) !== environmentSignature) return;
          live.onSend(prepared.request.draft, prepared.request.environment,
            { path: document.path, name: entry.name, line: entry.line, ...(environment ? { environment: environment.name } : {}) });
        }}>Send file request</button>
    </div>
  </details>;
}
