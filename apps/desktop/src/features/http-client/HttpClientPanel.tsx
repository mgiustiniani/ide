import type {
  HttpEnvironment,
  HttpRequestHeader,
  HttpRequestMethod,
  HttpRequestResult,
} from "@ide/contracts";
import { useEffect, useId, useRef, useState } from "react";
import type { OpenApiHttpOperation } from "./openapi";
import { OpenApiParameterForm } from "./OpenApiParameterForm";

import { HttpFileRequests } from "./HttpFileRequests";
import type { HttpClientPort } from "@ide/web-core/ports";
import { OAuthAuthorizationPanel } from "./OAuthAuthorizationPanel";
import { OAuthClientCredentialsPanel } from "./OAuthClientCredentialsPanel";
import { HttpAuthenticationFields } from "./HttpAuthenticationFields";
import type { HttpAuthentication } from "./httpAuthentication";
import type { HttpFileDocument, HttpRequestSource } from "./httpRequestFile";
import { HttpCollectionsPanel } from "./HttpCollectionsPanel";
import { resolveHttpRequest } from "./httpLibrary";
import type { useHttpClientLibrary } from "./useHttpClientLibrary";
import { useOpenApiFileImport } from "./useOpenApiFileImport";

const METHODS: readonly HttpRequestMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
];

interface HttpClientPanelProps {
  oauthPort?: HttpClientPort;
  busy: boolean;
  error: string | null;
  result: HttpRequestResult | null;
  workspaceAvailable: boolean;
  workspaceId: string | null;
  generation: number;
  openApiOperations: OpenApiHttpOperation[];
  openApiError: string | null;
  collections: ReturnType<typeof useHttpClientLibrary>;
  onSend: (
    request: HttpRequestDraft,
    environment?: HttpEnvironment,
    source?: HttpRequestSource,
  ) => void;
  activeDocument?: HttpFileDocument | null;
  getActiveDocument?(): HttpFileDocument | null;
  requestSource?: HttpRequestSource | null;
  supportsExplicitHttp11?: boolean;
  onLoadOpenApi: (source: string) => void;
}

interface HeaderDraft extends HttpRequestHeader {
  key: number;
}

export interface HttpRequestDraft {
  authentication?: HttpAuthentication;
  httpVersion?: "HTTP/1.1";
  redirectPolicy?: "none";
  method: HttpRequestMethod;
  url: string;
  headers: HttpRequestHeader[];
  body: string;
}

export function HttpClientPanel({
  busy,
  oauthPort,
  error,
  result,
  workspaceAvailable,
  workspaceId,
  generation,
  openApiOperations,
  openApiError,
  onSend,
  onLoadOpenApi,
  collections,
  activeDocument = null,
  getActiveDocument,
  requestSource = null,
  supportsExplicitHttp11 = false,
}: HttpClientPanelProps): JSX.Element {
  const id = useId();
  const [environmentName, setEnvironmentName] = useState("");
  const environment = collections.library.environments.find(
    (entry) => entry.name === environmentName,
  );
  const [method, setMethod] = useState<HttpRequestMethod>("GET");
  const [url, setUrl] = useState("");
  const [headers, setHeaders] = useState<HeaderDraft[]>([]);
  const [body, setBody] = useState("");
  const [oauthReset, setOAuthReset] = useState(0);
  const [authentication, setAuthentication] = useState<HttpAuthentication>({ kind: "none" });
  const [openApiText, setOpenApiText] = useState("");
  const [selectedOpenApiOperation, setSelectedOpenApiOperation] = useState("");
  const [loadedOpenApiText, setLoadedOpenApiText] = useState("");
  const [preparedOpenApiOperation, setPreparedOpenApiOperation] =
    useState<OpenApiHttpOperation | null>(null);
  const selectedOperation =
    openApiText === loadedOpenApiText
      ? openApiOperations.find((value) => value.id === selectedOpenApiOperation)
      : undefined;
  const pendingParameters =
    !!selectedOperation?.parameters?.length && preparedOpenApiOperation !== selectedOperation;
  const openApiAuthority = useRef({
    workspaceId,
    generation,
    openApiOperations,
    selectedOperation,
    workspaceAvailable,
  });
  openApiAuthority.current = {
    workspaceId,
    generation,
    openApiOperations,
    selectedOperation,
    workspaceAvailable,
  };
  const nextHeaderKey = useRef(0);
  const openApiFile = useOpenApiFileImport({
    workspaceId,
    generation,
    enabled: workspaceAvailable,
    onLoaded: (source) => {
      setOpenApiText(source);
      setLoadedOpenApiText(source);
      setPreparedOpenApiOperation(null);
      setSelectedOpenApiOperation("");
      onLoadOpenApi(source);
    },
  });

  useEffect(() => {
    setOAuthReset((value) => value + 1);
    setAuthentication({ kind: "none" });
    setEnvironmentName("");
    setMethod("GET");
    setUrl("");
    setHeaders([]);
    setBody("");
    setOpenApiText("");
    setLoadedOpenApiText("");
    setPreparedOpenApiOperation(null);
    setSelectedOpenApiOperation("");
  }, [workspaceId, generation]);

  const bodyAllowed =
    method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";

  function send(): void {
    if (busy || pendingParameters) return;
    onSend(
      {
        method,
        url,
        ...(authentication.kind === "none" ? {} : { authentication }),
        headers: headers.map(({ name, value }) => ({ name, value })),
        body: bodyAllowed ? body : "",
      },
      environment,
    );
  }

  function applyOpenApiOperation(
    operation: OpenApiHttpOperation,
    prepared = { url: operation.url, headers: [] as HttpRequestHeader[] },
  ): void {
    const generated = [
      ...prepared.headers,
      ...(operation.contentType ? [{ name: "Content-Type", value: operation.contentType }] : []),
    ];
    const names = new Set(generated.map((header) => header.name.toLowerCase()));
    const next = [
      ...headers.filter(
        (header) =>
          header.name.toLowerCase() !== "content-type" && !names.has(header.name.toLowerCase()),
      ),
      ...generated,
    ];
    if (
      next.length > 64 ||
      next.reduce(
        (total, header) => total + new TextEncoder().encode(header.name + header.value).length,
        0,
      ) >
        64 * 1024
    )
      throw new Error(
        "The prepared request would exceed the HTTP header limits. Remove existing header rows first.",
      );
    setMethod(operation.method);
    setUrl(prepared.url);
    setBody(operation.body ?? "");
    setHeaders(
      next.map((header) => ({
        ...header,
        key: "key" in header ? (header.key as number) : nextHeaderKey.current++,
      })),
    );
    setPreparedOpenApiOperation(operation);
  }
  function selectOpenApiOperation(operation: OpenApiHttpOperation | undefined): void {
    setOAuthReset((value) => value + 1);
    setAuthentication({ kind: "none" });
    setSelectedOpenApiOperation(operation?.id ?? "");
    setPreparedOpenApiOperation(null);
    if (!operation) {
      return;
    }
    if (operation.parameters?.length) return;
    applyOpenApiOperation(operation);
  }

  function updateHeader(key: number, field: "name" | "value", value: string): void {
    setHeaders((current) =>
      current.map((header) => (header.key === key ? { ...header, [field]: value } : header)),
    );
  }

  return (
    <section
      aria-label="HTTP client"
      className="flex h-full min-h-0 flex-col gap-3 overflow-auto p-3"
    >
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">HTTP Client</h2>
          <p className="text-xs text-[var(--text-secondary)]">
            {workspaceAvailable
              ? "Requests run only when you send them. Save reusable requests explicitly."
              : "Open a workspace to send requests. Drafts are not saved."}
          </p>
        </div>
        <span className="text-xs text-[var(--text-secondary)]">
          30 s timeout · 2 MiB response limit
        </span>
      </header>

      <HttpFileRequests
        document={activeDocument}
        getActiveDocument={getActiveDocument}
        workspaceId={workspaceAvailable ? workspaceId : null}
        generation={generation}
        busy={busy}
        environment={environment}
        onSend={onSend}
        supportsExplicitHttp11={supportsExplicitHttp11}
      />

      <HttpCollectionsPanel
        collections={collections}
        draft={{
          method,
          url,
          headers: headers.map(({ name, value }) => ({ name, value })),
          body: bodyAllowed ? body : "",
        }}
        workspaceId={workspaceId}
        generation={generation}
        environmentName={environmentName}
        onEnvironmentChange={setEnvironmentName}
        onLoad={(draft) => {
          setOAuthReset((value) => value + 1);
          setAuthentication({ kind: "none" });
          setMethod(draft.method);
          setUrl(draft.url);
          setBody(draft.body);
          setHeaders(draft.headers.map((header) => ({ ...header, key: nextHeaderKey.current++ })));
          setSelectedOpenApiOperation("");
        }}
      />

      <details className="shrink-0 rounded border border-[var(--border-default)] p-2">
        <summary className="cursor-pointer text-xs font-semibold text-[var(--text-secondary)]">
          OpenAPI routes
        </summary>
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-xs text-[var(--text-secondary)]">
            Paste an OpenAPI 3.0 or 3.1 JSON/YAML document or choose a UTF-8 file up to 1 MiB. It
            stays in memory and is never sent.
          </p>
          <label className="text-xs">
            Import OpenAPI file
            <input
              type="file"
              aria-label="Import OpenAPI file"
              accept=".json,.yaml,.yml,application/json,application/yaml,text/yaml"
              disabled={!workspaceAvailable}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) openApiFile.importFile(file);
              }}
            />
          </label>
          {openApiFile.pending && (
            <p role="status">
              Reading OpenAPI file…{" "}
              <button type="button" className="underline" onClick={openApiFile.cancel}>
                Cancel file import
              </button>
            </p>
          )}
          {openApiFile.fileName && <p role="status">Loaded OpenAPI file: {openApiFile.fileName}</p>}
          {openApiFile.error && (
            <p role="alert" aria-label="OpenAPI file error">
              {openApiFile.error}
            </p>
          )}
          <textarea
            aria-label="OpenAPI specification"
            className="min-h-24 resize-y rounded border border-[var(--border-default)] bg-[var(--surface-primary)] p-2 font-mono text-xs text-[var(--text-primary)]"
            maxLength={1024 * 1024}
            placeholder={"openapi: 3.0.3\nservers:\n  - url: http://localhost:8080\npaths: {}"}
            spellCheck={false}
            value={openApiText}
            onCompositionStart={() => {
              openApiFile.cancel();
              setSelectedOpenApiOperation("");
              setPreparedOpenApiOperation(null);
            }}
            onChange={(event) => {
              openApiFile.cancel();
              setOpenApiText(event.currentTarget.value);
              setSelectedOpenApiOperation("");
              setPreparedOpenApiOperation(null);
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded border border-[var(--border-default)] px-2 py-1 text-xs disabled:opacity-50"
              disabled={!workspaceAvailable || !openApiText.trim()}
              onClick={() => {
                openApiFile.cancel();
                setSelectedOpenApiOperation("");
                setLoadedOpenApiText(openApiText);
                setPreparedOpenApiOperation(null);
                onLoadOpenApi(openApiText);
              }}
            >
              Load OpenAPI
            </button>
            {openApiOperations.length > 0 ? (
              <select
                aria-label="OpenAPI operation"
                disabled={!workspaceAvailable || openApiText !== loadedOpenApiText}
                className="min-w-64 flex-1 rounded border border-[var(--border-default)] bg-[var(--surface-primary)] px-2 py-1 text-xs"
                value={selectedOpenApiOperation}
                onChange={(event) =>
                  selectOpenApiOperation(
                    openApiOperations.find(
                      (operation) => operation.id === event.currentTarget.value,
                    ),
                  )
                }
              >
                <option value="">Select an operation</option>
                {openApiOperations.map((operation) => (
                  <option key={operation.id} value={operation.id}>
                    {operation.label}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          {openApiOperations.length > 0 && openApiText !== loadedOpenApiText && (
            <p role="status">
              Specification changed. Load OpenAPI again before selecting an operation.
            </p>
          )}
          {selectedOperation?.parameters?.length ? (
            <OpenApiParameterForm
              key={selectedOperation.id}
              operation={selectedOperation}
              disabled={!workspaceAvailable || busy}
              prepared={!pendingParameters}
              onEdit={() => setPreparedOpenApiOperation(null)}
              onPrepared={(prepared) => {
                const latest = openApiAuthority.current;
                if (
                  latest.workspaceId !== workspaceId ||
                  latest.generation !== generation ||
                  !latest.workspaceAvailable ||
                  latest.selectedOperation !== selectedOperation ||
                  !latest.openApiOperations.includes(selectedOperation)
                )
                  return;
                applyOpenApiOperation(selectedOperation, prepared);
              }}
            />
          ) : null}
          {openApiError ? (
            <p
              role="alert"
              aria-label="OpenAPI import error"
              className="text-xs text-[var(--text-danger)]"
            >
              {openApiError}
            </p>
          ) : null}
          {openApiOperations.length > 0 ? (
            <p className="text-xs text-[var(--text-secondary)]">
              Prepare declared parameter values, then review the editable request before choosing
              Send. Local references to paths, parameters, request bodies and examples are resolved
              in this document. Authentication schemes and remote references are not applied.
            </p>
          ) : null}
        </div>
      </details>

      <form
        className="flex min-w-0 shrink-0 flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label className="sr-only" htmlFor={`${id}-method`}>
          HTTP method
        </label>
        <select
          id={`${id}-method`}
          aria-label="HTTP method"
          className="rounded border border-[var(--border-default)] bg-[var(--surface-primary)] px-2 py-1 text-sm"
          value={method}
          onChange={(event) => setMethod(event.currentTarget.value as HttpRequestMethod)}
        >
          {METHODS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor={`${id}-url`}>
          Request URL
        </label>
        <input
          id={`${id}-url`}
          aria-label="Request URL"
          autoCapitalize="off"
          autoComplete="url"
          autoCorrect="off"
          className="min-w-48 flex-1 rounded border border-[var(--border-default)] bg-[var(--surface-primary)] px-2 py-1 text-sm"
          maxLength={8192}
          placeholder="http://localhost:8080/api/hello"
          spellCheck={false}
          value={url}
          onChange={(event) => setUrl(event.currentTarget.value)}
        />
        <button
          type="submit"
          className="rounded bg-[var(--accent-primary)] px-3 py-1 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!workspaceAvailable || !url.trim() || busy || pendingParameters}
        >
          {busy ? "Sending…" : "Send"}
        </button>
      </form>

      {url.includes("{{") ? (
        <p
          aria-label="Resolved request URL"
          className="break-all text-xs text-[var(--text-secondary)]"
        >
          {(() => {
            try {
              return `Resolved URL: ${resolveHttpRequest({ method, url, headers: [], body: "" }, environment).url}`;
            } catch (error) {
              return error instanceof Error
                ? error.message
                : "Select an environment to resolve this URL.";
            }
          })()}
        </p>
      ) : null}

      <OAuthAuthorizationPanel key={"browser:" + oauthReset} port={oauthPort}
        workspaceId={workspaceId} generation={generation} enabled={!busy && workspaceAvailable} onUseToken={setAuthentication} />
      <OAuthClientCredentialsPanel key={oauthReset} port={oauthPort}
        workspaceId={workspaceId} generation={generation}
        enabled={!busy && workspaceAvailable} onUseToken={setAuthentication} />
      <HttpAuthenticationFields
        value={authentication}
        disabled={busy || !workspaceAvailable}
        onChange={setAuthentication}
      />

      <div className="grid auto-rows-[20rem] shrink-0 grid-cols-1 gap-3 xl:grid-cols-2">
        <div className="flex min-h-0 flex-col gap-3">
          <section aria-label="Request headers" className="flex shrink-0 flex-col gap-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                Headers
              </h3>
              <button
                type="button"
                className="rounded border border-[var(--border-default)] px-2 py-1 text-xs hover:bg-[var(--highlight-bg)]"
                onClick={() => {
                  const key = nextHeaderKey.current++;
                  setHeaders((current) => [...current, { key, name: "", value: "" }]);
                }}
                disabled={headers.length >= 64}
              >
                Add header
              </button>
            </div>
            {headers.length === 0 ? (
              <p className="text-xs text-[var(--text-secondary)]">No request headers.</p>
            ) : (
              <div className="flex max-h-40 flex-col gap-1 overflow-auto">
                {headers.map((header, index) => (
                  <div key={header.key} className="flex min-w-0 gap-1">
                    <input
                      aria-label={`Header ${index + 1} name`}
                      maxLength={256}
                      autoCapitalize="off"
                      autoComplete="off"
                      autoCorrect="off"
                      className="min-w-24 flex-1 rounded border border-[var(--border-default)] bg-[var(--surface-primary)] px-2 py-1 text-xs"
                      placeholder="Content-Type"
                      spellCheck={false}
                      value={header.name}
                      onChange={(event) =>
                        updateHeader(header.key, "name", event.currentTarget.value)
                      }
                    />
                    <input
                      aria-label={`Header ${index + 1} value`}
                      maxLength={16 * 1024}
                      autoCapitalize="off"
                      autoComplete="off"
                      autoCorrect="off"
                      className="min-w-24 flex-[2] rounded border border-[var(--border-default)] bg-[var(--surface-primary)] px-2 py-1 text-xs"
                      placeholder="application/json"
                      spellCheck={false}
                      value={header.value}
                      onChange={(event) =>
                        updateHeader(header.key, "value", event.currentTarget.value)
                      }
                    />
                    <button
                      type="button"
                      aria-label={`Remove header ${index + 1}`}
                      className="rounded border border-[var(--border-default)] px-2 text-xs hover:bg-[var(--highlight-bg)]"
                      onClick={() =>
                        setHeaders((current) => current.filter((item) => item.key !== header.key))
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <label className="flex min-h-0 flex-1 flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
            Request body
            <textarea
              aria-label="Request body"
              maxLength={1024 * 1024}
              className="min-h-24 flex-1 resize-y rounded border border-[var(--border-default)] bg-[var(--surface-primary)] p-2 font-mono text-xs normal-case tracking-normal text-[var(--text-primary)] disabled:opacity-50"
              disabled={!bodyAllowed}
              placeholder={
                bodyAllowed ? '{\n  "name": "example"\n}' : "This method does not send a body."
              }
              spellCheck={false}
              value={body}
              onChange={(event) => setBody(event.currentTarget.value)}
            />
          </label>
        </div>

        <section aria-label="HTTP response" className="flex min-h-0 flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
              Response
            </h3>
            {result ? (
              <span role="status" className="text-xs text-[var(--text-secondary)]">
                {result.status} {result.reason} · {result.elapsedMs} ms
                {result.body.truncated ? " · body truncated" : ""}
              </span>
            ) : null}
          </div>
          {requestSource && (
            <p aria-label="HTTP request source" className="text-xs text-[var(--text-secondary)]">
              {requestSource.path}:{requestSource.line} · {requestSource.name}
              {requestSource.environment ? ` · ${requestSource.environment}` : ""}
            </p>
          )}
          {error ? (
            <p role="alert" className="rounded border border-[var(--border-danger)] p-2 text-sm">
              {error}
            </p>
          ) : null}
          {!result && !error ? (
            <p className="text-xs text-[var(--text-secondary)]">
              Send a request to view its response.
            </p>
          ) : null}
          {result ? (
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto">
              <details>
                <summary className="cursor-pointer text-xs text-[var(--text-secondary)]">
                  Response headers{result.headersTruncated ? " (truncated)" : ""}
                </summary>
                <dl className="mt-1 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
                  {result.headers.map((header, index) => (
                    <div key={`${header.name}-${index}`} className="contents">
                      <dt className="font-mono text-[var(--text-secondary)]">{header.name}</dt>
                      <dd className="break-all font-mono text-[var(--text-primary)]">
                        {header.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </details>
              <div className="min-h-0 flex-1 overflow-auto rounded border border-[var(--border-default)] bg-[var(--surface-primary)] p-2">
                {result.body.encoding === "base64" ? (
                  <p className="mb-1 text-xs text-[var(--text-secondary)]">
                    Binary response body shown as base64.
                  </p>
                ) : null}
                <pre className="whitespace-pre-wrap break-words font-mono text-xs text-[var(--text-primary)]">
                  {result.body.content || "(empty response body)"}
                </pre>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </section>
  );
}
