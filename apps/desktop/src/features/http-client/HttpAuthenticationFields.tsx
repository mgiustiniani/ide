import type { HttpAuthentication } from "./httpAuthentication";

export function HttpAuthenticationFields({
  value,
  disabled,
  onChange,
}: {
  value: HttpAuthentication;
  disabled: boolean;
  onChange(value: HttpAuthentication): void;
}) {
  const inputClass =
    "rounded border border-[var(--border-default)] bg-[var(--surface-editor)] px-2 py-1 text-sm";
  return (
    <section aria-label="Request authentication" className="flex shrink-0 flex-col gap-2">
      <label className="flex flex-col gap-1 text-xs">
        Authentication
        <select
          aria-label="Authentication"
          className={inputClass}
          value={value.kind}
          disabled={disabled}
          onChange={(event) =>
            onChange(
              event.currentTarget.value === "basic"
                ? { kind: "basic", username: "", password: "" }
                : event.currentTarget.value === "bearer"
                  ? { kind: "bearer", token: "" }
                  : { kind: "none" },
            )
          }
        >
          <option value="none">None</option>
          <option value="basic">Basic</option>
          <option value="bearer">Bearer token</option>
        </select>
      </label>
      {value.kind === "basic" ? (
        <>
          <label className="flex flex-col gap-1 text-xs">
            Basic username
            <input
              aria-label="Basic username"
              className={inputClass}
              value={value.username}
              autoComplete="off"
              spellCheck={false}
              disabled={disabled}
              maxLength={8192}
              onChange={(event) => onChange({ ...value, username: event.currentTarget.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Basic password
            <input
              aria-label="Basic password"
              type="password"
              className={inputClass}
              value={value.password}
              autoComplete="off"
              spellCheck={false}
              disabled={disabled}
              maxLength={8192}
              onChange={(event) => onChange({ ...value, password: event.currentTarget.value })}
            />
          </label>
        </>
      ) : null}
      {value.kind === "bearer" ? (
        <label className="flex flex-col gap-1 text-xs">
          Bearer token
          <input
            aria-label="Bearer token"
            type="password"
            className={inputClass}
            value={value.token}
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            maxLength={16384}
            onChange={(event) => onChange({ kind: "bearer", token: event.currentTarget.value })}
          />
        </label>
      ) : null}
      {value.kind !== "none" ? (
        <p className="text-xs text-[var(--text-secondary)]">
          These fields stay in memory and are excluded from saved requests and exports. Send
          credentials over HTTPS.
        </p>
      ) : null}
    </section>
  );
}
