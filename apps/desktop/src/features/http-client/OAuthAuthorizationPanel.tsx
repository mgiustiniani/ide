import { useEffect, useRef, useState } from "react";
import type {
  OAuthAuthorizationSession,
  OAuthAuthorizationSessionRequest,
  OAuthAuthorizationStartRequest,
  OAuthAuthorizationTokenResult,
} from "@ide/contracts";
import type { HttpClientPort } from "@ide/web-core/ports";
import type { HttpAuthentication } from "./httpAuthentication";

interface Props {
  port?: HttpClientPort;
  workspaceId: string | null;
  generation: number;
  enabled: boolean;
  onUseToken(value: HttpAuthentication): void;
}
type Draft = Omit<
  OAuthAuthorizationStartRequest,
  "workspaceId" | "generation" | "requestId" | "callbackPort"
> & { callbackPort: string };
const EMPTY: Draft = {
  authorizationUrl: "",
  tokenUrl: "",
  issuer: "",
  clientId: "",
  clientSecret: "",
  clientAuthentication: "none",
  scope: "",
  allowLoopbackHttp: false,
  callbackPort: "0",
};
const inputClass =
  "rounded border border-[var(--border-default)] bg-[var(--surface-editor)] px-2 py-1 text-sm";
interface Captured {
  props: Props;
  session: OAuthAuthorizationSession;
  draft: Draft;
}
function cleanup(captured: Captured) {
  const request: OAuthAuthorizationSessionRequest = {
    workspaceId: captured.session.workspaceId,
    generation: captured.session.generation,
    requestId: `oauth-cancel-${crypto.randomUUID()}`,
    sessionId: captured.session.sessionId,
  };
  return captured.props.port!.cancelOAuthAuthorization!(request);
}

/** Browser consent and native code exchange never submit the protected API request. */
export function OAuthAuthorizationPanel(props: Props): JSX.Element {
  const { port, workspaceId, generation, enabled, onUseToken } = props;
  const [draft, setDraft] = useState(EMPTY),
    [pending, setPending] = useState(false),
    [cancelling, setCancelling] = useState(false);
  const [session, setSession] = useState<Captured | null>(null);
  const [token, setToken] = useState<{
    result: OAuthAuthorizationTokenResult;
    captured: Captured;
  } | null>(null);
  const [status, setStatus] = useState<string | null>(null),
    [error, setError] = useState(false),
    [now, setNow] = useState(Date.now);
  const latest = useRef({ props, draft });
  latest.current = { props, draft };
  const alive = useRef(true),
    sequence = useRef(0),
    inFlight = useRef(false),
    cancellationRequested = useRef(false);
  const cancelOutcome = useRef<"requested" | "confirmed" | "unconfirmed" | null>(null);
  const active = useRef<Captured | null>(null);
  function sameScope(source: Props) {
    const value = latest.current.props;
    return (
      alive.current &&
      value.port === source.port &&
      value.workspaceId === source.workspaceId &&
      value.generation === source.generation
    );
  }
  useEffect(() => {
    sequence.current += 1;
    setDraft(EMPTY);
    setToken(null);
    setSession(null);
    setStatus(null);
    setError(false);
  }, [port, workspaceId, generation]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      sequence.current += 1;
      const captured = active.current;
      active.current = null;
      if (captured)
        void cleanup(captured).catch(() => {
          /* Native timeout/activation checks remain authoritative. */
        });
    };
  }, [port, workspaceId, generation]);
  useEffect(() => {
    if (token?.result.expiresAt === null || !token) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [token]);
  const capable = !!(
    port?.beginOAuthAuthorization &&
    port.completeOAuthAuthorization &&
    port.cancelOAuthAuthorization
  );
  const callbackPort = Number(draft.callbackPort);
  const valid = !!(
    draft.authorizationUrl &&
    draft.tokenUrl &&
    draft.issuer &&
    draft.clientId &&
    (draft.clientAuthentication === "none" || draft.clientSecret) &&
    Number.isInteger(callbackPort) &&
    callbackPort >= 0 &&
    callbackPort <= 65535 &&
    (callbackPort === 0 || callbackPort >= 1024)
  );
  function update(value: Partial<Draft>) {
    sequence.current += 1;
    setDraft((old) => ({ ...old, ...value }));
    setToken(null);
    setStatus(null);
    setError(false);
  }
  async function start() {
    if (!capable || !valid || !enabled || !workspaceId || inFlight.current) return;
    const source = props,
      sourceDraft = draft,
      id = ++sequence.current;
    const current = () =>
      sameScope(source) && latest.current.draft === sourceDraft && sequence.current === id;
    inFlight.current = true;
    cancellationRequested.current = false;
    cancelOutcome.current = null;
    setPending(true);
    setToken(null);
    setSession(null);
    setError(false);
    setStatus("Requesting sign-in in your system browser…");
    let captured: Captured | null = null,
      completed = false;
    try {
      const request: OAuthAuthorizationStartRequest = {
        ...sourceDraft,
        callbackPort,
        workspaceId,
        generation,
        requestId: `oauth-sign-in-${crypto.randomUUID()}`,
      };
      const response = await port!.beginOAuthAuthorization!(request);
      if (
        response.workspaceId !== workspaceId ||
        response.generation !== generation ||
        response.requestId !== request.requestId ||
        typeof response.sessionId !== "string" ||
        !/^[A-Za-z0-9_-]{32}$/u.test(response.sessionId) ||
        typeof response.redirectUri !== "string" ||
        !Number.isSafeInteger(response.expiresIn) ||
        response.expiresIn < 1 ||
        response.expiresIn > 300
      )
        throw new Error("Malformed sign-in session");
      captured = { props: source, session: response, draft: sourceDraft };
      active.current = captured;
      if (!current()) return;
      setSession(captured);
      setStatus(
        "Browser launch requested. Complete consent in that browser. Cancel here if it did not open or you want to stop.",
      );
      const completion: OAuthAuthorizationSessionRequest = {
        workspaceId,
        generation,
        sessionId: response.sessionId,
        requestId: `oauth-complete-${crypto.randomUUID()}`,
      };
      const result = await port!.completeOAuthAuthorization!(completion);
      if (!current()) return;
      if (
        result.workspaceId !== workspaceId ||
        result.generation !== generation ||
        result.requestId !== completion.requestId ||
        result.sessionId !== response.sessionId ||
        result.tokenType !== "Bearer" ||
        typeof result.accessToken !== "string" ||
        result.accessToken.length > 16384 ||
        !/^[A-Za-z0-9._~+/-]+=*$/u.test(result.accessToken) ||
        (result.expiresIn !== null &&
          (!Number.isSafeInteger(result.expiresIn) ||
            result.expiresIn < 0 ||
            result.expiresIn > 2147483647)) ||
        (result.expiresIn === null
          ? result.expiresAt !== null
          : !Number.isSafeInteger(result.expiresAt) || result.expiresAt! < 0) ||
        (result.scope !== null &&
          (typeof result.scope !== "string" ||
            result.scope.length > 8192 ||
            /\p{Cc}/u.test(result.scope)))
      )
        throw new Error("Malformed sign-in token");
      completed = true;
      setToken({ result, captured });
      setNow(Date.now());
      setStatus(
        "OAuth authorization completed. Review the token scope, then choose Use sign-in token. No API request has been sent.",
      );
    } catch {
      if (current()) {
        setError(true);
        setStatus(
          "OAuth sign-in did not complete. Check the browser, configured issuer, endpoint and registered loopback callback. State and issuer mismatches are refused.",
        );
      }
    } finally {
      if (captured && !completed) {
        try {
          await cleanup(captured);
          if (cancellationRequested.current) cancelOutcome.current = "confirmed";
        } catch {
          if (cancellationRequested.current) cancelOutcome.current = "unconfirmed";
          /* Failure is already shown; never report successful sign-in. */
        }
      }
      if (active.current === captured) active.current = null;
      inFlight.current = false;
      if (alive.current) {
        setPending(false);
        setSession(null);
      }
      if (sameScope(source)) {
        if (cancellationRequested.current) {
          const confirmed = cancelOutcome.current === "confirmed";
          setStatus(
            confirmed
              ? "OAuth sign-in cancelled locally. The browser remains under your control."
              : "Sign-in cancellation could not be confirmed. The native listener remains bounded by its timeout.",
          );
          setError(!confirmed);
        }
      }
    }
  }
  async function cancel() {
    if (!pending || cancelling) return;
    cancellationRequested.current = true;
    cancelOutcome.current = "requested";
    sequence.current += 1;
    setCancelling(true);
    setToken(null);
    const source = props,
      captured = active.current;
    try {
      if (captured) {
        await cleanup(captured);
        cancelOutcome.current = "confirmed";
      }
      if (sameScope(source))
        setStatus(
          captured
            ? "OAuth sign-in cancelled locally. The browser remains under your control."
            : "Cancellation requested; waiting for native sign-in startup to finish.",
        );
    } catch {
      cancelOutcome.current = "unconfirmed";
      if (sameScope(source)) {
        setError(true);
        setStatus(
          "Sign-in cancellation could not be confirmed. The native listener remains bounded by its timeout.",
        );
      }
    } finally {
      if (alive.current) setCancelling(false);
    }
  }
  const visible =
    token && sameScope(token.captured.props) && token.captured.draft === draft ? token : null;
  const expired =
    visible?.result.expiresAt !== null &&
    visible?.result.expiresAt !== undefined &&
    now >= visible.result.expiresAt;
  function useToken() {
    if (
      !enabled ||
      !visible ||
      (visible.result.expiresAt !== null && Date.now() >= visible.result.expiresAt)
    )
      return;
    onUseToken({
      kind: "bearer",
      token: visible.result.accessToken,
      oauth: { allowLoopbackHttp: visible.captured.draft.allowLoopbackHttp },
      ...(visible.result.expiresAt === null ? {} : { expiresAt: visible.result.expiresAt }),
    });
    setStatus(
      "Sign-in token selected as Bearer authentication. Review the API URL and choose Send when ready.",
    );
  }
  const disabled = pending || cancelling || !enabled;
  return (
    <details
      aria-label="OAuth browser authorization"
      className="shrink-0 rounded border border-[var(--border-default)] p-2 text-xs"
    >
      <summary>OAuth 2.0 browser sign-in (PKCE)</summary>
      <section className="mt-2 flex flex-col gap-2">
        <p>
          Use a registered Authorization Code client with S256 PKCE and a loopback callback at
          /oauth/callback. Login and consent run in your system browser. The provider must return
          its issuer (iss) in the authorization response.
        </p>
        {(
          [
            ["authorizationUrl", "Authorization endpoint", "OAuth authorization endpoint"],
            ["tokenUrl", "Token endpoint", "OAuth sign-in token endpoint"],
            ["issuer", "Expected issuer", "OAuth expected issuer"],
            ["clientId", "Client ID", "OAuth sign-in client ID"],
            ["scope", "Scopes (space separated)", "OAuth sign-in scopes"],
          ] as const
        ).map(([field, label, aria]) => (
          <label key={field}>
            {label}
            <input
              aria-label={aria}
              className={inputClass}
              autoComplete="off"
              spellCheck={false}
              maxLength={8192}
              value={draft[field]}
              disabled={disabled}
              onChange={(event) => update({ [field]: event.target.value })}
            />
          </label>
        ))}
        <label>
          Client authentication
          <select
            aria-label="OAuth sign-in client authentication"
            className={inputClass}
            value={draft.clientAuthentication}
            disabled={disabled}
            onChange={(event) =>
              update({
                clientAuthentication: event.target.value as Draft["clientAuthentication"],
                clientSecret: "",
              })
            }
          >
            <option value="none">Public client (no secret)</option>
            <option value="basic">HTTP Basic</option>
            <option value="body">Request body</option>
          </select>
        </label>
        {draft.clientAuthentication !== "none" ? (
          <label>
            Client secret
            <input
              aria-label="OAuth sign-in client secret"
              type="password"
              autoComplete="off"
              className={inputClass}
              value={draft.clientSecret}
              disabled={disabled}
              maxLength={8192}
              onChange={(event) => update({ clientSecret: event.target.value })}
            />
          </label>
        ) : null}
        <label>
          Callback port (0 selects an available port)
          <input
            aria-label="OAuth callback port"
            type="number"
            min={0}
            max={65535}
            className={inputClass}
            value={draft.callbackPort}
            disabled={disabled}
            onChange={(event) => update({ callbackPort: event.target.value })}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.allowLoopbackHttp}
            disabled={disabled}
            onChange={(event) => update({ allowLoopbackHttp: event.target.checked })}
          />{" "}
          Allow HTTP for numeric loopback development endpoints
        </label>
        <p>
          Remote endpoints require HTTPS. Sign-in expires after five minutes. Client settings and
          tokens remain in memory and are excluded from saved requests and exports.
        </p>
        <button
          type="button"
          className={inputClass}
          disabled={disabled || !capable || !valid}
          onClick={() => void start()}
        >
          {pending ? "Waiting for browser sign-in…" : "Sign in with system browser"}
        </button>
        {pending ? (
          <button
            type="button"
            className={inputClass}
            disabled={cancelling}
            onClick={() => void cancel()}
          >
            {cancelling ? "Cancelling sign-in…" : "Cancel browser sign-in"}
          </button>
        ) : null}
        {session && sameScope(session.props) ? (
          <p aria-label="OAuth redirect URI">Callback: {session.session.redirectUri}</p>
        ) : null}
        {visible ? (
          <div aria-label="OAuth sign-in token metadata">
            <p>
              Token type: Bearer. Granted scope:{" "}
              {visible.result.scope ?? (draft.scope || "not reported")}.{" "}
              {visible.result.expiresIn === null
                ? "Lifetime not reported; the server enforces validity."
                : `Reported lifetime: ${visible.result.expiresIn} seconds.`}
            </p>
            {expired ? <p>Sign-in token expired. Sign in again.</p> : null}
            <button
              type="button"
              className={inputClass}
              disabled={!enabled || expired}
              onClick={useToken}
            >
              Use sign-in token
            </button>
          </div>
        ) : null}
        <button
          type="button"
          className={inputClass}
          disabled={disabled}
          onClick={() => {
            sequence.current += 1;
            setDraft(EMPTY);
            setToken(null);
            setStatus(null);
            setError(false);
            onUseToken({ kind: "none" });
          }}
        >
          Clear browser sign-in credentials and authentication
        </button>
        {!capable ? (
          <p>Browser sign-in requires a desktop host with PKCE and callback support.</p>
        ) : null}
        {status ? (
          <p role={error ? "alert" : "status"} aria-label="OAuth browser status">
            {status}
          </p>
        ) : null}
      </section>
    </details>
  );
}
