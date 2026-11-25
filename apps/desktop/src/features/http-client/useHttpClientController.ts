import type { HttpEnvironment, HttpRequestResult, HttpRequestSubmission } from "@ide/contracts";
import type { HttpClientPort } from "@ide/web-core/ports";
import { useCallback, useEffect, useRef, useState } from "react";
import type { HttpRequestDraft } from "./HttpClientPanel";
import type { HttpRequestSource } from "./httpRequestFile";
import { resolveHttpRequest } from "./httpLibrary";
import { parseOpenApiOperations, type OpenApiHttpOperation } from "./openapi";

export interface HttpClientControllerState {
  busy: boolean;
  error: string | null;
  result: HttpRequestResult | null;
  workspaceAvailable: boolean;
  requestSource: HttpRequestSource | null;
}

interface OpenApiControllerState {
  openApiOperations: OpenApiHttpOperation[];
  openApiError: string | null;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "The HTTP request failed.";
}

export function useHttpClientController(
  port: HttpClientPort,
  workspaceId: string | null,
  generation: number,
): HttpClientControllerState &
  OpenApiControllerState & {
    send: (draft: HttpRequestDraft, environment?: HttpEnvironment, source?: HttpRequestSource) => void;
    loadOpenApi: (source: string) => void;
  } {
  const [state, setState] = useState<HttpClientControllerState>({
    busy: false,
    error: null,
    result: null,
    workspaceAvailable: workspaceId !== null,
    requestSource: null,
  });
  const [openApiState, setOpenApiState] = useState<OpenApiControllerState>({
    openApiOperations: [],
    openApiError: null,
  });
  const currentAuthority = useRef({ workspaceId, generation });
  currentAuthority.current = { workspaceId, generation };
  const requestSequence = useRef(0);
  const requestInFlight = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    currentAuthority.current = { workspaceId, generation };
    requestSequence.current += 1;
    requestInFlight.current = false;
    setState({ busy: false, error: null, result: null, workspaceAvailable: workspaceId !== null, requestSource: null });
    setOpenApiState({ openApiOperations: [], openApiError: null });
  }, [workspaceId, generation]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      requestSequence.current += 1;
      requestInFlight.current = false;
    };
  }, []);

  const send = useCallback(
    (draft: HttpRequestDraft, environment?: HttpEnvironment, source?: HttpRequestSource) => {
      if (!workspaceId || requestInFlight.current || !alive.current ||
        currentAuthority.current.workspaceId !== workspaceId || currentAuthority.current.generation !== generation) return;
      let resolved: HttpRequestDraft;
      try {
        if (draft.httpVersion && !port.supportsExplicitHttp11) throw new Error("This HTTP backend cannot honor an explicit HTTP/1.1 version.");
        resolved = resolveHttpRequest(draft, environment);
        if (resolved.redirectPolicy && !port.supportsNoRedirects)
          throw new Error("This HTTP backend cannot refuse redirects for an OAuth Bearer request.");
      } catch (error) {
        setState((state) => ({ ...state, error: errorText(error), result: null, requestSource: source ? { ...source } : null }));
        return;
      }
      requestInFlight.current = true;
      const sequence = ++requestSequence.current;
      const authority = { workspaceId, generation };
      const request: HttpRequestSubmission = {
        ...authority,
        requestId: `http-${Date.now()}-${sequence}`,
        method: resolved.method,
        ...(resolved.httpVersion ? { httpVersion: resolved.httpVersion } : {}),
        ...(resolved.redirectPolicy ? { redirectPolicy: resolved.redirectPolicy } : {}),
        url: resolved.url,
        headers: resolved.headers,
        body: resolved.body,
      };
      const isCurrent = () => {
        const current = currentAuthority.current;
        return (
          alive.current &&
          sequence === requestSequence.current &&
          current.workspaceId === authority.workspaceId &&
          current.generation === authority.generation
        );
      };
      setState((current) => ({
        ...current,
        busy: true,
        error: null,
        result: null,
        workspaceAvailable: true,
        requestSource: source ? { ...source } : null,
      }));
      void port
        .send(request)
        .then((result) => {
          if (!isCurrent()) return;
          if (
            result.workspaceId !== request.workspaceId ||
            result.generation !== request.generation ||
            result.requestId !== request.requestId
          ) {
            throw new Error("The HTTP response does not match the submitted request.");
          }
          setState((current) => ({
            ...current,
            busy: false,
            error: null,
            result,
            workspaceAvailable: true,
          }));
        })
        .catch((error: unknown) => {
          if (isCurrent())
            setState((current) => ({
              ...current,
              busy: false,
              error: errorText(error),
              result: null,
              workspaceAvailable: true,
            }));
        })
        .finally(() => {
          if (sequence === requestSequence.current) requestInFlight.current = false;
        });
    },
    [generation, port, workspaceId],
  );

  const loadOpenApi = useCallback(
    (source: string) => {
      if (!workspaceId || !alive.current || currentAuthority.current.workspaceId !== workspaceId ||
        currentAuthority.current.generation !== generation) return;
      try {
        setOpenApiState({ openApiOperations: parseOpenApiOperations(source), openApiError: null });
      } catch (error) {
        setOpenApiState({ openApiOperations: [], openApiError: errorText(error) });
      }
    },
    [workspaceId, generation],
  );

  return { ...state, ...openApiState, send, loadOpenApi };
}
