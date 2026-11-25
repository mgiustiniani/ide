import type { HttpClientPort } from "@ide/web-core/ports";
import {
  normalizeHttpLibrary,
  type OAuthClientCredentialsRequest, type OAuthTokenResult,
  type OAuthAuthorizationStartRequest, type OAuthAuthorizationSession,
  type OAuthAuthorizationSessionRequest, type OAuthAuthorizationTokenResult, type OAuthAuthorizationCancelResult,
  type HttpLibraryRequest,
  type HttpLibrarySave,
  type HttpLibraryExport,
  type HttpLibraryExportAs,
  type HttpLibraryExportResult,
  type HttpLibrarySnapshot,
  type HttpRequestResult,
  type HttpRequestSubmission,
} from "@ide/contracts";
import { invokeTauri } from "./errors";

export const HTTP_CLIENT_COMMAND = "send_http_request";

const MAX_RESPONSE_HEADERS = 128;
const MAX_RESPONSE_HEADER_TEXT = 64 * 1024;
const MAX_RESPONSE_CONTENT_TEXT = 3 * 1024 * 1024;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid HTTP response from the desktop host.");
  }
  return value as Record<string, unknown>;
}

function normalizeResult(value: unknown, request: HttpRequestSubmission): HttpRequestResult {
  const data = object(value);
  const body = object(data.body);
  if (
    data.workspaceId !== request.workspaceId ||
    data.generation !== request.generation ||
    data.requestId !== request.requestId ||
    !Number.isSafeInteger(data.status) ||
    (data.status as number) < 100 ||
    (data.status as number) > 599 ||
    typeof data.reason !== "string" ||
    data.reason.length > 256 ||
    !Number.isSafeInteger(data.elapsedMs) ||
    (data.elapsedMs as number) < 0 ||
    !Array.isArray(data.headers) ||
    data.headers.length > MAX_RESPONSE_HEADERS ||
    (data.headersTruncated !== true && data.headersTruncated !== false) ||
    (body.encoding !== "utf-8" && body.encoding !== "base64") ||
    typeof body.content !== "string" ||
    body.content.length > MAX_RESPONSE_CONTENT_TEXT ||
    typeof body.truncated !== "boolean"
  ) {
    throw new Error("Uncorrelated or malformed HTTP response from the desktop host.");
  }

  let headerTextSize = 0;
  const headers = data.headers.map((entry) => {
    const header = object(entry);
    if (
      typeof header.name !== "string" ||
      header.name.length === 0 ||
      header.name.length > 256 ||
      typeof header.value !== "string" ||
      header.value.length > 16 * 1024
    ) {
      throw new Error("Malformed HTTP response header from the desktop host.");
    }
    headerTextSize += header.name.length + header.value.length;
    if (headerTextSize > MAX_RESPONSE_HEADER_TEXT) {
      throw new Error("HTTP response headers exceed the display limit.");
    }
    return { name: header.name, value: header.value };
  });

  return {
    workspaceId: request.workspaceId,
    generation: request.generation,
    requestId: request.requestId,
    status: data.status as number,
    reason: data.reason,
    elapsedMs: data.elapsedMs as number,
    headers,
    headersTruncated: data.headersTruncated,
    body: {
      encoding: body.encoding,
      content: body.content,
      truncated: body.truncated,
    },
  };
}

function normalizeLibrary(value: unknown, request: HttpLibraryRequest): HttpLibrarySnapshot {
  const data = object(value);
  if (
    data.workspaceId !== request.workspaceId ||
    data.generation !== request.generation ||
    data.requestId !== request.requestId ||
    typeof data.revision !== "string" ||
    !/^[a-f0-9]{64}$/u.test(data.revision)
  )
    throw new Error("Uncorrelated HTTP collections from the desktop host.");
  return {
    workspaceId: request.workspaceId,
    generation: request.generation,
    requestId: request.requestId,
    revision: data.revision,
    library: normalizeHttpLibrary(data.library),
  };
}

function normalizeOAuthToken(value: unknown, request: HttpLibraryRequest): OAuthTokenResult {
    const data = object(value);
    if (data.workspaceId !== request.workspaceId || data.generation !== request.generation || data.requestId !== request.requestId ||
        typeof data.accessToken !== "string" || data.accessToken.length > 16384 || !/^[A-Za-z0-9._~+/-]+=*$/u.test(data.accessToken) ||
        data.tokenType !== "Bearer" || (data.expiresIn !== null && (!Number.isSafeInteger(data.expiresIn) || (data.expiresIn as number) < 0 || (data.expiresIn as number) > 2147483647)) ||
        (data.scope !== null && (typeof data.scope !== "string" || data.scope.length > 8192 ||
          (data.scope !== "" && !/^[\x21\x23-\x5b\x5d-\x7e]+(?: [\x21\x23-\x5b\x5d-\x7e]+)*$/u.test(data.scope))))) {
      throw new Error("Uncorrelated or malformed OAuth token from the desktop host.");
    }
    return {workspaceId:request.workspaceId,generation:request.generation,requestId:request.requestId,
      accessToken:data.accessToken,tokenType:"Bearer",expiresIn:data.expiresIn as number|null,scope:data.scope as string|null};
}

export class TauriHttpClientAdapter implements HttpClientPort {
  readonly supportsExplicitHttp11 = true;
  readonly supportsNoRedirects = true;
  async requestClientCredentialsToken(request: OAuthClientCredentialsRequest): Promise<OAuthTokenResult> {
    return normalizeOAuthToken(await invokeTauri("request_oauth_client_credentials_token", {request}), request);
  }
  async beginOAuthAuthorization(request: OAuthAuthorizationStartRequest): Promise<OAuthAuthorizationSession> {
    const data = object(await invokeTauri("begin_oauth_authorization", {request}));
    let redirect: URL;
    try { redirect = new URL(typeof data.redirectUri === "string" ? data.redirectUri : ""); }
    catch { throw new Error("Malformed OAuth callback from the desktop host."); }
    if (data.workspaceId !== request.workspaceId || data.generation !== request.generation || data.requestId !== request.requestId ||
        typeof data.sessionId !== "string" || !/^[A-Za-z0-9_-]{32}$/u.test(data.sessionId) ||
        redirect.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(redirect.hostname) ||
        redirect.username || redirect.password || redirect.search || redirect.hash || redirect.pathname !== "/oauth/callback" ||
        !Number.isInteger(Number(redirect.port)) || Number(redirect.port) < 1024 || Number(redirect.port) > 65535 ||
        (request.callbackPort !== 0 && Number(redirect.port) !== request.callbackPort) ||
        !Number.isSafeInteger(data.expiresIn) || (data.expiresIn as number) < 1 || (data.expiresIn as number) > 300) {
      throw new Error("Uncorrelated or malformed OAuth sign-in session from the desktop host.");
    }
    return {workspaceId:request.workspaceId,generation:request.generation,requestId:request.requestId,
      sessionId:data.sessionId,redirectUri:redirect.href,expiresIn:data.expiresIn as number};
  }
  async completeOAuthAuthorization(request: OAuthAuthorizationSessionRequest): Promise<OAuthAuthorizationTokenResult> {
    const data = object(await invokeTauri("complete_oauth_authorization", {request}));
    const token = normalizeOAuthToken(data, request);
    if (data.sessionId !== request.sessionId || (token.expiresIn === null ? data.expiresAt !== null :
      !Number.isSafeInteger(data.expiresAt) || (data.expiresAt as number) < 0))
      throw new Error("Uncorrelated or malformed OAuth sign-in token from the desktop host.");
    return {...token,sessionId:request.sessionId,expiresAt:data.expiresAt as number|null};
  }
  async cancelOAuthAuthorization(request: OAuthAuthorizationSessionRequest): Promise<OAuthAuthorizationCancelResult> {
    const data = object(await invokeTauri("cancel_oauth_authorization", {request}));
    if (data.workspaceId !== request.workspaceId || data.generation !== request.generation || data.requestId !== request.requestId ||
        data.sessionId !== request.sessionId || data.cancelled !== true)
      throw new Error("The desktop host did not confirm retirement of the OAuth sign-in.");
    return {...request,cancelled:true};
  }

  async exportLibraryAs(request: HttpLibraryExportAs): Promise<HttpLibraryExportResult | null> {
    const value = await invokeTauri<unknown>("export_http_library_as", { request });
    if (value === null) return null;
    const data = object(value);
    if (
      data.workspaceId !== request.workspaceId ||
      data.generation !== request.generation ||
      data.requestId !== request.requestId ||
      data.revision !== request.expectedRevision ||
      typeof data.filePath !== "string" ||
      data.filePath.length > 32768 ||
      /[\p{Cc}]/u.test(data.filePath) ||
      !(
        data.filePath.startsWith("/") ||
        /^[A-Za-z]:[\\/]/u.test(data.filePath) ||
        data.filePath.startsWith("\\\\")
      ) ||
      !Number.isSafeInteger(data.byteLength) ||
      (data.byteLength as number) < 1 ||
      (data.byteLength as number) > 2 * 1024 * 1024
    )
      throw new Error("Uncorrelated HTTP collection export from the desktop host.");
    return {
      workspaceId: request.workspaceId,
      generation: request.generation,
      requestId: request.requestId,
      revision: request.expectedRevision,
      filePath: data.filePath,
      byteLength: data.byteLength as number,
    };
  }
  async exportLibrary(request: HttpLibraryExport): Promise<HttpLibraryExportResult> {
    const data = object(await invokeTauri("export_http_library", { request }));
    if (
      data.workspaceId !== request.workspaceId ||
      data.generation !== request.generation ||
      data.requestId !== request.requestId ||
      data.revision !== request.expectedRevision ||
      data.filePath !== request.filePath ||
      !Number.isSafeInteger(data.byteLength) ||
      (data.byteLength as number) < 1 ||
      (data.byteLength as number) > 2 * 1024 * 1024
    )
      throw new Error("Uncorrelated HTTP collection export from the desktop host.");
    return {
      workspaceId: request.workspaceId,
      generation: request.generation,
      requestId: request.requestId,
      filePath: request.filePath,
      revision: data.revision as string,
      byteLength: data.byteLength as number,
    };
  }
  async loadLibrary(request: HttpLibraryRequest): Promise<HttpLibrarySnapshot> {
    return normalizeLibrary(await invokeTauri("load_http_library", { request }), request);
  }
  async saveLibrary(request: HttpLibrarySave): Promise<HttpLibrarySnapshot> {
    return normalizeLibrary(
      await invokeTauri("save_http_library", {
        request: { ...request, library: normalizeHttpLibrary(request.library) },
      }),
      request,
    );
  }
  async send(request: HttpRequestSubmission): Promise<HttpRequestResult> {
    return normalizeResult(await invokeTauri(HTTP_CLIENT_COMMAND, { request }), request);
  }
}

export { normalizeResult as normalizeHttpRequestResult };
