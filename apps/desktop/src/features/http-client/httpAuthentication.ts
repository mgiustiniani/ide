import type { HttpRequestHeader } from "@ide/contracts";

export type HttpAuthentication =
  | { kind: "none" }
  | { kind: "basic"; username: string; password: string }
  | { kind: "bearer"; token: string; expiresAt?: number; oauth?: { allowLoopbackHttp: boolean } };

const LIMIT = 16 * 1024;
/** Build only an explicit Authorization header; callers retain the unsaved credential inputs. */
export function authenticatedHeaders(
  headers: HttpRequestHeader[],
  authentication?: HttpAuthentication,
): HttpRequestHeader[] {
  if (!authentication || authentication.kind === "none") return headers;
  if (headers.some((header) => header.name.trim().toLowerCase() === "authorization"))
    throw new Error("Remove the Authorization header or choose None authentication.");
  if (headers.length >= 64) throw new Error("Authentication would exceed the 64-header limit.");
  let value: string;
  if (authentication.kind === "basic") {
    const { username, password } = authentication;
    if (username.includes(":")) throw new Error("Basic username cannot contain a colon.");
    if (/\p{Cc}/u.test(username + password))
      throw new Error("Basic values cannot contain control characters.");
    const text = `${username}:${password}`;
    if (text.length > LIMIT) throw new Error("Authentication values exceed the 16 KiB limit.");
    const bytes = new TextEncoder().encode(text);
    if (bytes.length > LIMIT) throw new Error("Authentication values exceed the 16 KiB limit.");
    if (new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes) !== text)
      throw new Error("Basic values must contain valid Unicode text.");
    value = `Basic ${btoa(String.fromCharCode(...bytes))}`;
  } else if (authentication.kind === "bearer") {
    const { token, expiresAt } = authentication;
    if (expiresAt !== undefined && (!Number.isSafeInteger(expiresAt) || Date.now() >= expiresAt))
      throw new Error("The OAuth token has expired. Acquire and use a new token before sending.");
    if (token.length > LIMIT) throw new Error("Bearer token exceeds the 16 KiB limit.");
    if (!/^[A-Za-z0-9._~+/-]+=*$/u.test(token))
      throw new Error("Enter a bearer token using valid HTTP token characters.");
    value = `Bearer ${token}`;
  } else throw new Error("The authentication type is unsupported.");
  return [...headers, { name: "Authorization", value }];
}
