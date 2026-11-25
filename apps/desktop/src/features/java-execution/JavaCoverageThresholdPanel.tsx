import {
  coverageCounterKinds,
  coverageThresholdError,
  type JavaCoverageThresholdCheck,
  type JavaCoverageThresholdSettings,
} from "./javaCoverageThresholds";

export function JavaCoverageThresholdPanel({
  settings,
  onChange,
  disabled,
  check,
}: {
  settings: JavaCoverageThresholdSettings;
  onChange(settings: JavaCoverageThresholdSettings): void;
  disabled: boolean;
  check: JavaCoverageThresholdCheck | null;
}) {
  const invalid = coverageThresholdError(settings);
  return (
    <section
      aria-label="Java coverage thresholds"
      className="flex flex-col gap-2 rounded border p-2"
    >
      <h3 className="font-semibold">Coverage thresholds</h3>
      <p className="text-xs">
        Minimum percentages for coverage runs. Leave a counter empty to disable its check. Saved
        with this configuration; each execution retains the thresholds it started with.
      </p>
      {coverageCounterKinds.map((kind) => (
        <label key={kind}>
          Minimum {kind} coverage (%)
          <input
            type="text"
            inputMode="decimal"
            maxLength={6}
            value={settings[kind]}
            disabled={disabled}
            className="w-full rounded border bg-[var(--surface-editor)] p-1"
            onChange={(event) => onChange({ ...settings, [kind]: event.target.value })}
          />
        </label>
      ))}
      {invalid && <p role="alert">{invalid}</p>}
      {check && (
        <div aria-label="Coverage threshold result">
          <p
            role={check.status === "failed" || check.status === "unavailable" ? "alert" : "status"}
          >
            Coverage thresholds: {check.status}. {check.message}
          </p>
          <p className="text-xs">
            This check is separate from the build-tool outcome and does not change its exit code.
            Checks use reported counts before rounding.
          </p>
          <ul>
            {coverageCounterKinds
              .filter((kind) => check.settings[kind] !== "")
              .map((kind) => {
                const counter = check.counters?.[kind];
                const total = counter ? counter.covered + counter.missed : 0;
                return (
                  <li key={kind}>
                    {kind}: required {check.settings[kind]}%; measured{" "}
                    {counter && total
                      ? `${((100 * counter.covered) / total).toFixed(4)}% (${counter.covered} / ${total})`
                      : "unavailable"}
                  </li>
                );
              })}
          </ul>
        </div>
      )}
    </section>
  );
}
