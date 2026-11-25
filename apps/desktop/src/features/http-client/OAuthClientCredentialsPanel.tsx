import { useEffect, useRef, useState } from "react";
import type { OAuthClientCredentialsRequest, OAuthTokenResult } from "@ide/contracts";
import type { HttpClientPort } from "@ide/web-core/ports";
import type { HttpAuthentication } from "./httpAuthentication";

interface Props {
  port?: HttpClientPort;
  workspaceId: string | null;
  generation: number;
  enabled: boolean;
  onUseToken(value: HttpAuthentication): void;
}
interface Draft {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
  clientAuthentication: "basic" | "body";
  allowLoopbackHttp: boolean;
}
const EMPTY: Draft = {
  tokenUrl: "",
  clientId: "",
  clientSecret: "",
  scope: "",
  clientAuthentication: "basic",
  allowLoopbackHttp: false,
};
const inputClass =
  "rounded border border-[var(--border-default)] bg-[var(--surface-editor)] px-2 py-1 text-sm";

/** Deliberate token acquisition and use are separate from submitting the protected API request. */
export function OAuthClientCredentialsPanel(props: Props): JSX.Element {
  const { port, workspaceId, generation, enabled, onUseToken } = props;
  const [draft, setDraft] = useState(EMPTY);
  const [pending, setPending] = useState(false);
  const [token, setToken] = useState<{
    result: OAuthTokenResult;
    expiresAt?: number;
    authority: Props;
    draft: Draft;
  } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(Date.now);
  const latest = useRef({ props, draft });
  latest.current = { props, draft };
  const alive = useRef(true);
  const sequence = useRef(0);
  const inFlight = useRef(false);
  useEffect(() => {
    sequence.current += 1;
    setDraft(EMPTY);
    setToken(null);
    setStatus(null);
    setError(false);
  }, [port, workspaceId, generation]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      sequence.current += 1;
    };
  }, []);
  useEffect(() => {
    if (token?.expiresAt === undefined) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [token]);
  function update(patch: Partial<Draft>) {
    sequence.current += 1;
    setDraft((value) => ({ ...value, ...patch }));
    setToken(null);
    setStatus(null);
    setError(false);
  }
  function sameScope(authority: Props) {
    const current = latest.current.props;
    return (
      alive.current &&
      current.port === authority.port &&
      current.workspaceId === authority.workspaceId &&
      current.generation === authority.generation
    );
  }
  const visibleToken = token && sameScope(token.authority) && token.draft === draft ? token : null;
  const expired = visibleToken?.expiresAt !== undefined && now >= visibleToken.expiresAt;
  async function acquire() {
    if (
      !enabled ||
      !workspaceId ||
      !port?.requestClientCredentialsToken ||
      inFlight.current ||
      !draft.tokenUrl ||
      !draft.clientId ||
      !draft.clientSecret
    )
      return;
    const authority = props,
      source = draft,
      id = ++sequence.current,
      started = Date.now();
    const current = () =>
      sameScope(authority) && latest.current.draft === source && sequence.current === id;
    inFlight.current = true;
    setPending(true);
    setToken(null);
    setStatus(null);
    setError(false);
    const request: OAuthClientCredentialsRequest = {
      ...source,
      workspaceId,
      generation,
      requestId: `oauth-${crypto.randomUUID()}`,
    };
    try {
      const result = await port.requestClientCredentialsToken(request);
      if (!current()) return;
      if (
        result.workspaceId !== workspaceId ||
        result.generation !== generation ||
        result.requestId !== request.requestId ||
        result.tokenType !== "Bearer" ||
        typeof result.accessToken !== "string" ||
        result.accessToken.length > 16384 ||
        !/^[A-Za-z0-9._~+/-]+=*$/u.test(result.accessToken) ||
        (result.expiresIn !== null &&
          (!Number.isSafeInteger(result.expiresIn) ||
            result.expiresIn < 0 ||
            result.expiresIn > 2147483647)) ||
        (result.scope !== null &&
          (typeof result.scope !== "string" ||
            result.scope.length > 8192 ||
            /\p{Cc}/u.test(result.scope)))
      ) {
        throw new Error("Malformed token");
      }
      const expiresAt = result.expiresIn === null ? undefined : started + result.expiresIn * 1000;
      setToken({ result, expiresAt, authority, draft: source });
      setNow(Date.now());
      setStatus(
        "Token acquired in memory. Review its scope, then choose Use token. The API request has not been sent.",
      );
    } catch {
      if (current()) {
        setError(true);
        setStatus(
          "OAuth token acquisition failed. Check the endpoint, client authentication and scopes. Redirects and unsupported responses are refused.",
        );
      }
    } finally {
      inFlight.current = false;
      if (alive.current) setPending(false);
    }
  }
  function useToken() {
    if (
      !enabled ||
      !visibleToken ||
      !sameScope(visibleToken.authority) ||
      (visibleToken.expiresAt !== undefined && Date.now() >= visibleToken.expiresAt)
    )
      return;
    onUseToken({
      kind: "bearer",
      token: visibleToken.result.accessToken,
      oauth: { allowLoopbackHttp: visibleToken.draft.allowLoopbackHttp },
      ...(visibleToken.expiresAt === undefined ? {} : { expiresAt: visibleToken.expiresAt }),
    });
    setStatus(
      "Token selected as Bearer authentication. Review the request URL and choose Send request when ready.",
    );
  }
  return (
    <details
      className="shrink-0 rounded border border-[var(--border-default)] p-2 text-xs"
      aria-label="OAuth Client Credentials"
    >
      <summary>OAuth 2.0 Client Credentials</summary>
      <section className="mt-2 flex flex-col gap-2">
        <p>
          Acquire a service account token using credentials issued by your authorization server.
          Values stay in memory and are excluded from saved requests and exports.
        </p>
        <label>
          Token endpoint URL
          <input
            aria-label="OAuth token endpoint"
            className={inputClass}
            autoComplete="off"
            spellCheck={false}
            value={draft.tokenUrl}
            maxLength={8192}
            disabled={pending || !enabled}
            onChange={(event) => update({ tokenUrl: event.target.value })}
          />
        </label>
        <label>
          Client ID
          <input
            aria-label="OAuth client ID"
            className={inputClass}
            autoComplete="off"
            spellCheck={false}
            value={draft.clientId}
            maxLength={8192}
            disabled={pending || !enabled}
            onChange={(event) => update({ clientId: event.target.value })}
          />
        </label>
        <label>
          Client secret
          <input
            aria-label="OAuth client secret"
            type="password"
            className={inputClass}
            autoComplete="off"
            value={draft.clientSecret}
            maxLength={8192}
            disabled={pending || !enabled}
            onChange={(event) => update({ clientSecret: event.target.value })}
          />
        </label>
        <label>
          Scopes (space separated)
          <input
            aria-label="OAuth scopes"
            className={inputClass}
            autoComplete="off"
            spellCheck={false}
            value={draft.scope}
            maxLength={8192}
            disabled={pending || !enabled}
            onChange={(event) => update({ scope: event.target.value })}
          />
        </label>
        <label>
          Client authentication
          <select
            aria-label="OAuth client authentication"
            className={inputClass}
            value={draft.clientAuthentication}
            disabled={pending || !enabled}
            onChange={(event) =>
              update({ clientAuthentication: event.target.value as "basic" | "body" })
            }
          >
            <option value="basic">HTTP Basic (client_secret_basic)</option>
            <option value="body">Request body (client_secret_post)</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.allowLoopbackHttp}
            disabled={pending || !enabled}
            onChange={(event) => update({ allowLoopbackHttp: event.target.checked })}
          />{" "}
          Allow HTTP for a numeric loopback development endpoint
        </label>
        <p>
          Use HTTPS for real services. The local development exception accepts only loopback IP
          addresses. Redirects are not followed.
        </p>
        <button
          type="button"
          className={inputClass}
          disabled={
            !enabled ||
            pending ||
            !port?.requestClientCredentialsToken ||
            !draft.tokenUrl ||
            !draft.clientId ||
            !draft.clientSecret
          }
          onClick={() => void acquire()}
        >
          {pending ? "Requesting OAuth token…" : "Get OAuth token"}
        </button>
        <button
          type="button"
          className={inputClass}
          disabled={pending || !enabled}
          onClick={() => {
            sequence.current += 1;
            setDraft(EMPTY);
            setToken(null);
            setStatus(null);
            setError(false);
            onUseToken({ kind: "none" });
          }}
        >
          Clear OAuth credentials and request authentication
        </button>
        {!port?.requestClientCredentialsToken ? (
          <p>OAuth acquisition requires a desktop host that supports Client Credentials.</p>
        ) : null}
        {visibleToken ? (
          <div aria-label="OAuth token metadata">
            <p>
              Token type: Bearer. Granted scope:{" "}
              {visibleToken.result.scope ?? (draft.scope || "not reported")}.{" "}
              {visibleToken.result.expiresIn === null
                ? "Lifetime not reported; expiry is enforced by the server."
                : `Reported lifetime: ${visibleToken.result.expiresIn} seconds.`}
            </p>
            {expired ? <p>Token expired. Acquire a new token.</p> : null}
            <button
              type="button"
              className={inputClass}
              disabled={!enabled || pending || expired}
              onClick={useToken}
            >
              Use OAuth token
            </button>
          </div>
        ) : null}
        {status ? (
          <p role={error ? "alert" : "status"} aria-label="OAuth status">
            {status}
          </p>
        ) : null}
      </section>
    </details>
  );
}
