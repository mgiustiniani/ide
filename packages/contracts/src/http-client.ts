export type HttpRequestMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export interface HttpRequestHeader {
  name: string;
  value: string;
}

export interface HttpRequestSubmission {
  workspaceId: string;
  generation: number;
  requestId: string;
  method: HttpRequestMethod;
  url: string;
  headers: HttpRequestHeader[];
  body: string;
  /** Explicit protocol selection, when advertised by the HTTP port. */
  httpVersion?: "HTTP/1.1";
  /** Do not follow redirects, when supported by the transport. */
  redirectPolicy?: "none";
}

export interface HttpResponseBody {
  encoding: "utf-8" | "base64";
  content: string;
  truncated: boolean;
}

export interface HttpRequestResponseHeader {
  name: string;
  value: string;
}

export interface HttpRequestResult {
  workspaceId: string;
  generation: number;
  requestId: string;
  status: number;
  reason: string;
  elapsedMs: number;
  headers: HttpRequestResponseHeader[];
  headersTruncated: boolean;
  body: HttpResponseBody;
}

export interface HttpSavedRequest {
  collection: string;
  name: string;
  method: HttpRequestMethod;
  url: string;
  headers: HttpRequestHeader[];
  body: string;
}
export interface HttpEnvironment {
  name: string;
  variables: Record<string, string>;
}
export interface HttpRequestLibrary {
  version: 1;
  requests: HttpSavedRequest[];
  environments: HttpEnvironment[];
}
export interface HttpLibraryRequest {
  workspaceId: string;
  generation: number;
  requestId: string;
}
export interface HttpLibrarySnapshot extends HttpLibraryRequest {
  revision: string;
  library: HttpRequestLibrary;
}
/** Destination is selected by the native save dialog, never supplied by the renderer. */
export interface HttpLibraryExportAs extends HttpLibraryRequest {
  expectedRevision: string;
}
export interface HttpLibraryExport extends HttpLibraryRequest {
  expectedRevision: string;
  filePath: string;
}
export interface HttpLibraryExportResult extends HttpLibraryRequest {
  revision: string;
  filePath: string;
  byteLength: number;
}
export interface HttpLibrarySave extends HttpLibraryRequest {
  expectedRevision: string;
  library: HttpRequestLibrary;
}

/** Validate persisted data without retaining unknown fields or mutable native objects. */
export function normalizeHttpLibrary(value: unknown): HttpRequestLibrary {
  const fail = (): never => {
    throw new Error("Invalid HTTP collection data. Nothing was saved.");
  };
  const object = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : fail();
  const text = (value: unknown, max: number): string =>
    typeof value === "string" &&
    new TextEncoder().encode(value).length <= max &&
    !value.includes("\0")
      ? value
      : fail();
  const name = (value: unknown) => {
    const result = text(value, 128);
    return result.trim() === result && result.length > 0 && !/\p{Cc}/u.test(result)
      ? result
      : fail();
  };
  const data = object(value);
  if (
    data.version !== 1 ||
    !Array.isArray(data.requests) ||
    data.requests.length > 100 ||
    !Array.isArray(data.environments) ||
    data.environments.length > 32
  )
    return fail();
  const requests = data.requests.map((raw): HttpSavedRequest => {
    const entry = object(raw);
    const method = entry.method as HttpRequestMethod;
    if (
      !["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(method) ||
      !Array.isArray(entry.headers) ||
      entry.headers.length > 64
    )
      return fail();
    let headerBytes = 0;
    const headers = entry.headers.map((raw) => {
      const header = object(raw);
      const result = { name: text(header.name, 256), value: text(header.value, 16 * 1024) };
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(result.name) || /[\r\n]/u.test(result.value))
        return fail();
      headerBytes += new TextEncoder().encode(result.name + result.value).length;
      return result;
    });
    if (headerBytes > 64 * 1024) return fail();
    return {
      collection: name(entry.collection),
      name: name(entry.name),
      method,
      url: text(entry.url, 8192),
      headers,
      body: text(entry.body, 1024 * 1024),
    };
  });
  const environments = data.environments.map((raw): HttpEnvironment => {
    const entry = object(raw);
    const variables = Object.entries(object(entry.variables));
    if (variables.length > 64) return fail();
    for (const [key, value] of variables) {
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/u.test(key)) return fail();
      text(value, 8192);
    }
    return {
      name: name(entry.name),
      variables: Object.fromEntries(variables) as Record<string, string>,
    };
  });
  if (
    new Set(requests.map((entry) => JSON.stringify([entry.collection, entry.name]))).size !==
      requests.length ||
    new Set(environments.map((entry) => entry.name)).size !== environments.length
  )
    return fail();
  const library: HttpRequestLibrary = { version: 1, requests, environments };
  if (new TextEncoder().encode(JSON.stringify(library)).length > 2 * 1024 * 1024) return fail();
  return library;
}


/** Explicit token acquisition; none of these fields belongs to the saved request library. */
export interface OAuthClientCredentialsRequest extends HttpLibraryRequest {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
  clientAuthentication: "basic" | "body";
  allowLoopbackHttp: boolean;
}
export interface OAuthTokenResult extends HttpLibraryRequest {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number | null;
  scope: string | null;
}


export interface OAuthAuthorizationStartRequest extends HttpLibraryRequest {
  authorizationUrl: string;
  tokenUrl: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  clientAuthentication: "none" | "basic" | "body";
  scope: string;
  allowLoopbackHttp: boolean;
  /** Zero selects an available port. A configured port must be unprivileged. */
  callbackPort: number;
}
export interface OAuthAuthorizationSession extends HttpLibraryRequest {
  sessionId: string;
  redirectUri: string;
  expiresIn: number;
}
export interface OAuthAuthorizationSessionRequest extends HttpLibraryRequest {
  sessionId: string;
}
export interface OAuthAuthorizationTokenResult extends OAuthTokenResult {
  sessionId: string;
  /** Native wall-clock deadline computed when the token exchange starts. */
  expiresAt: number | null;
}
export interface OAuthAuthorizationCancelResult extends OAuthAuthorizationSessionRequest {
  cancelled: true;
}
