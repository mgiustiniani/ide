import { useState } from "react";
import type { JavaSourceBreakpoints } from "./useJavaSourceBreakpoints";
import { JAVA_DEBUGGER_EXPRESSION_HELP } from "./javaDebuggerExpressionHelp";

export function JavaSourceBreakpointsPanel({
  controller,
  disabled,
}: {
  controller: JavaSourceBreakpoints;
  disabled: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ key: string; context: string } | null>(null);
  const [condition, setCondition] = useState("");
  const [hitCount, setHitCount] = useState("");
  const [logMessage, setLogMessage] = useState("");
  const apply = async (action: () => void | Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Saved breakpoints could not be changed.");
    }
  };
  return (
    <section aria-label="Saved Java source breakpoints" className="flex flex-col gap-2">
      <h3 className="font-semibold">Saved source breakpoints</h3>
      <p>
        Set a breakpoint from the Java editor margin or F9. Saved breakpoints use Structured Java
        debugger (JDI); they are verified when the JVM loads their source.
      </p>
      <p>After changing a source, review its line positions and rebind that file before Debug.</p>
      <p>
        Conditions are read-only expressions evaluated in the breakpoint event's top frame. A
        positive matching-hit count stops once on that occurrence; zero or an empty count stops on
        every match. Counters start again for each Debug session. Edit these saved settings before
        starting Debug. A nonempty log message makes the breakpoint resume without suspending;
        interpolate read-only values with {"{expression}"}.
      </p>
      <p>{JAVA_DEBUGGER_EXPRESSION_HELP}</p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={disabled || !controller.points.length}
          onClick={() => void apply(controller.rebindActive)}
        >
          Rebind active file
        </button>
        <button
          type="button"
          disabled={disabled || (!controller.points.length && !controller.error)}
          onClick={() => void apply(controller.clear)}
        >
          Clear saved breakpoints
        </button>
      </div>
      {(error || controller.error) && <p role="alert">{error ?? controller.error}</p>}
      {controller.review?.relocations.map((item) => (
        <p key={`${item.sourcePath}:${item.fromLine}`} role="status">
          {item.status === "unique" && item.toLine !== undefined
            ? `${item.sourcePath}:${item.fromLine} has one matching source context at line ${item.toLine}. Rebind will move it there.`
            : item.status === "ambiguous"
              ? `${item.sourcePath}:${item.fromLine} matches multiple source contexts. Reposition or remove it before rebinding.`
              : item.status === "unmatched"
                ? `${item.sourcePath}:${item.fromLine} has no matching source context. Rebind keeps its current line; review it or reposition/remove it first.`
                : item.status === "scan-limit"
                  ? `${item.sourcePath}:${item.fromLine} could not be checked because the file exceeds the 5,000-line context scan limit. Rebind keeps its current line; review it or reposition/remove it first.`
                  : `${item.sourcePath}:${item.fromLine} has no saved source context. Review its line manually before rebinding.`}
        </p>
      ))}
      {controller.points.length === 0 ? (
        <p>No saved source breakpoints.</p>
      ) : (
        <ul>
          {controller.points.map((point) => (
            <li
              key={`${point.sourcePath}:${point.line}`}
              className="flex flex-wrap items-center gap-2"
            >
              <label>
                <input
                  type="checkbox"
                  checked={point.enabled}
                  disabled={disabled}
                  onChange={(event) =>
                    void apply(() =>
                      controller.enable(point.sourcePath, point.line, event.target.checked),
                    )
                  }
                />
                {point.sourcePath}:{point.line}
              </label>
              {point.condition && <span>Condition: {point.condition}</span>}
              {(point.hitCount ?? 0) > 0 && <span>Stop on matching hit {point.hitCount}</span>}
              {point.logMessage && <span>Log: {point.logMessage}</span>}
              <button
                type="button"
                disabled={disabled}
                aria-label={`Edit condition for ${point.sourcePath}:${point.line}`}
                onClick={() => {
                  setEditing({
                    key: `${point.sourcePath}:${point.line}`,
                    context: controller.contextKey,
                  });
                  setCondition(point.condition ?? "");
                  setHitCount(point.hitCount ? String(point.hitCount) : "");
                  setLogMessage(point.logMessage ?? "");
                }}
              >
                Edit condition
              </button>
              <button
                type="button"
                disabled={disabled}
                aria-label={`Remove saved breakpoint ${point.sourcePath}:${point.line}`}
                onClick={() => void apply(() => controller.remove(point.sourcePath, point.line))}
              >
                Remove
              </button>
              {editing?.key === `${point.sourcePath}:${point.line}` &&
                editing.context === controller.contextKey && (
                  <form
                    aria-label={`Condition for ${point.sourcePath}:${point.line}`}
                    className="flex w-full flex-col gap-2 border p-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void apply(() => {
                        controller.configure(point.sourcePath, point.line, {
                          condition,
                          hitCount: hitCount === "" ? 0 : Number(hitCount),
                          logMessage,
                        });
                        setEditing(null);
                      });
                    }}
                  >
                    <label>
                      Saved breakpoint condition
                      <input
                        className="w-full rounded border bg-[var(--surface-editor)] p-1"
                        disabled={disabled}
                        value={condition}
                        placeholder="i >= 2 && i % 2 == 0"
                        onChange={(event) => setCondition(event.target.value)}
                      />
                    </label>
                    <label>
                      Saved breakpoint matching hit
                      <input
                        type="number"
                        min="0"
                        max="1000000000"
                        step="1"
                        disabled={disabled}
                        value={hitCount}
                        onChange={(event) => setHitCount(event.target.value)}
                      />
                    </label>
                    <label>
                      Saved breakpoint log message (optional)
                      <input
                        className="w-full rounded border bg-[var(--surface-editor)] p-1"
                        disabled={disabled}
                        value={logMessage}
                        placeholder="i={i}, value={holder.values[0]}"
                        onChange={(event) => setLogMessage(event.target.value)}
                      />
                    </label>
                    <p>
                      {JAVA_DEBUGGER_EXPRESSION_HELP} A log message with {"{expression}"}{" "}
                      placeholders uses the same evaluator; object values show type and identity.
                      Invalid syntax is refused by the debugger before application execution.
                    </p>
                    <div className="flex gap-2">
                      <button type="submit" disabled={disabled}>
                        Save breakpoint condition
                      </button>
                      <button type="button" onClick={() => setEditing(null)}>
                        Cancel condition edit
                      </button>
                    </div>
                  </form>
                )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
