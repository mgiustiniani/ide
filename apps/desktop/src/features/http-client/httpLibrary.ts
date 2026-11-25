import type { HttpEnvironment, HttpRequestLibrary } from "@ide/contracts";
import type { HttpRequestDraft } from "./HttpClientPanel";
import { authenticatedHeaders, type HttpAuthentication } from "./httpAuthentication";

export const emptyHttpLibrary = (): HttpRequestLibrary => ({
  version: 1,
  requests: [],
  environments: [],
});

/** Literal, single-pass substitutions: values are never evaluated or expanded recursively. */
export function resolveHttpRequest(
  draft: HttpRequestDraft,
  environment?: HttpEnvironment,
): HttpRequestDraft {
  let total = 0;
  let inputBytes = 0;
  let variableBytes = 0;
  let substitutions = 0;
  const expand = (source: string): string => {
    if (source.length > 2 * 1024 * 1024)
      throw new Error("The HTTP request exceeds the 2 MiB limit.");
    inputBytes += new TextEncoder().encode(source).length;
    if (inputBytes > 2 * 1024 * 1024) throw new Error("The HTTP request exceeds the 2 MiB limit.");
    const remaining = source.replace(/\{\{([^{}]*)\}\}/gu, "");
    if (remaining.includes("{{")) throw new Error("An HTTP variable placeholder is incomplete.");
    const result = source.replace(/\{\{([^{}]*)\}\}/gu, (_match, raw: string) => {
      const key = raw.trim();
      if (
        !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/u.test(key) ||
        !environment ||
        !Object.hasOwn(environment.variables, key)
      )
        throw new Error(
          `HTTP variable ${key ? `“${key.slice(0, 128)}”` : "name"} is not defined in the selected environment.`,
        );
      if (++substitutions > 10000)
        throw new Error("The HTTP request has too many variable substitutions.");
      const value = environment.variables[key]!;
      variableBytes += new TextEncoder().encode(value).length;
      if (variableBytes > 2 * 1024 * 1024)
        throw new Error("The expanded HTTP request exceeds the 2 MiB limit.");
      return value;
    });
    total += new TextEncoder().encode(result).length;
    if (total > 2 * 1024 * 1024)
      throw new Error("The expanded HTTP request exceeds the 2 MiB limit.");
    return result;
  };
  const resolved: HttpRequestDraft = {
    method: draft.method,
    ...(draft.httpVersion ? { httpVersion: draft.httpVersion } : {}),
    ...(draft.redirectPolicy ? { redirectPolicy: draft.redirectPolicy } : {}),
    url: expand(draft.url),
    headers: draft.headers.map((header) => ({ name: header.name, value: expand(header.value) })),
    body: expand(draft.body),
  };
  let authentication: HttpAuthentication | undefined;
  try {
    const input = draft.authentication;
    authentication = !input
      ? undefined
      : input.kind === "basic"
        ? { kind: "basic", username: expand(input.username), password: expand(input.password) }
        : input.kind === "bearer"
          ? { kind: "bearer", token: expand(input.token), ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}), ...(input.oauth ? { oauth: { ...input.oauth } } : {}) }
          : input;
  } catch {
    throw new Error(
      "Authentication values could not be resolved. Check the selected environment and request limits.",
    );
  }
  if (authentication?.kind === "bearer" && authentication.oauth) {
    const url = new URL(resolved.url);
    const loopback = url.hostname === "[::1]" || /^127\.(?:[0-9]{1,3}\.){2}[0-9]{1,3}$/u.test(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback && authentication.oauth.allowLoopbackHttp))
      throw new Error("OAuth Bearer requests require HTTPS or the explicitly enabled numeric loopback development exception.");
    return { ...resolved, headers: authenticatedHeaders(resolved.headers, authentication), redirectPolicy: "none" };
  }
  return { ...resolved, headers: authenticatedHeaders(resolved.headers, authentication) };
}
