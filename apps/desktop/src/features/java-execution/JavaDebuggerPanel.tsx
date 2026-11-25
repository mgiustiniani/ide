import { isJavaBinaryName } from "@ide/contracts";
import React, { useEffect, useRef, useState } from "react";
import type { JavaDebuggerAction, JavaDebuggerState, JavaDebuggerVariable } from "@ide/contracts";
import { validBreakpointOptions } from "./javaSourceBreakpoints";
import { JAVA_DEBUGGER_EXPRESSION_HELP } from "./javaDebuggerExpressionHelp";
import { javaDebuggerAvailability } from "./javaDebuggerAvailability";
import { parseJavaStepFilters } from "./javaStepFilters";

const buttonClass = "rounded border border-[var(--border-default)] px-2 py-1 disabled:opacity-40";
const fieldClass =
  "w-full rounded border border-[var(--border-default)] bg-[var(--surface-editor)] p-1 font-mono";

function VariableTable({
  label,
  variables,
  inspect,
  disabled,
}: {
  label: string;
  variables: JavaDebuggerVariable[];
  inspect(variable: JavaDebuggerVariable): void;
  disabled: boolean;
}) {
  return (
    <table aria-label={label} className="w-full text-left text-xs">
      <thead>
        <tr>
          <th>Name</th>
          <th>Type</th>
          <th>Value</th>
          <th>Children</th>
        </tr>
      </thead>
      <tbody>
        {variables.map((variable, index) => (
          <tr key={`${index}:${variable.name}`}>
            <td className="pr-2 font-mono">{variable.name}</td>
            <td className="pr-2">{variable.type}</td>
            <td className="pr-2 font-mono">
              {variable.value}
              {variable.valueTruncated && <span title="Value preview was truncated">…</span>}
            </td>
            <td>
              {variable.reference ? (
                <button
                  className={buttonClass}
                  aria-label={`Inspect ${variable.name}`}
                  disabled={disabled}
                  onClick={() => inspect(variable)}
                >
                  {variable.childCount} children
                </button>
              ) : variable.childCount > 0 ? (
                `${variable.childCount} (expansion unavailable)`
              ) : (
                ""
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Typed JDI values; this view never interprets the console as runtime state. */
export function JavaDebuggerPanel({
  state,
  active,
  action,
  commandError,
  stepFilterText = "",
  onStepFilterTextChange,
}: {
  state?: JavaDebuggerState;
  active: boolean;
  action(action: JavaDebuggerAction): void;
  commandError?: string | null;
  stepFilterText?: string;
  onStepFilterTextChange?(text: string): void;
}) {
  const [breakpoint, setBreakpoint] = useState("");
  const [watch, setWatch] = useState("");
  const [exceptionClass, setExceptionClass] = useState("");
  const [exceptionSubclasses, setExceptionSubclasses] = useState(true);
  useEffect(() => {
    setExceptionClass(state?.exceptionClassName ?? "");
    setExceptionSubclasses(state?.exceptionIncludeSubclasses ?? true);
  }, [active, state?.exceptionClassName, state?.exceptionIncludeSubclasses]);
  const exceptionClassName = exceptionClass.trim();
  const validExceptionClass = !exceptionClassName || isJavaBinaryName(exceptionClassName);
  const stepFilters = parseJavaStepFilters(stepFilterText);
  const [localEdit, setLocalEdit] = useState<{
    assignment: string;
    stopId: string;
    frameId: string;
  } | null>(null);
  const [pendingEvaluation, setPendingEvaluation] = useState<{
    expression: string;
    stopId: string;
    frameId: string;
  } | null>(null);
  const pendingEvaluationErrorBaseline = useRef<{
    stateError: string | null;
    commandError: string | null;
  } | null>(null);
  const [condition, setCondition] = useState("");
  const [hitCount, setHitCount] = useState("");
  const [logMessage, setLogMessage] = useState("");
  const matchingHit = hitCount === "" ? 0 : Number(hitCount);
  const validOptions = validBreakpointOptions({ condition, hitCount: matchingHit, logMessage });
  const [inspectedName, setInspectedName] = useState("");
  const { suspended, ready, canStep, canPause } = javaDebuggerAvailability(state, active);
  useEffect(() => {
    if (!pendingEvaluation) return;
    if (
      !active ||
      !state ||
      state.status === "terminated" ||
      !suspended ||
      state.stopId !== pendingEvaluation.stopId ||
      state.selectedFrameId !== pendingEvaluation.frameId
    ) {
      setPendingEvaluation(null);
      pendingEvaluationErrorBaseline.current = null;
      return;
    }
    if (
      state.evaluation?.stopId === pendingEvaluation.stopId &&
      state.evaluation.frameId === pendingEvaluation.frameId &&
      state.evaluation.expression === pendingEvaluation.expression
    ) {
      setPendingEvaluation(null);
      pendingEvaluationErrorBaseline.current = null;
      return;
    }
    const hasNewError =
      (!!commandError && commandError !== pendingEvaluationErrorBaseline.current?.commandError) ||
      (!!state.error && state.error !== pendingEvaluationErrorBaseline.current?.stateError);
    if (hasNewError) {
      setPendingEvaluation(null);
      pendingEvaluationErrorBaseline.current = null;
    }
  }, [active, commandError, pendingEvaluation, state, suspended]);
  useEffect(() => {
    if (!pendingEvaluation) return;
    const timeout = setTimeout(() => {
      setPendingEvaluation(null);
      pendingEvaluationErrorBaseline.current = null;
    }, 10_000);
    return () => clearTimeout(timeout);
  }, [pendingEvaluation]);
  const selectedFrame = state?.frames.find((frame) => frame.id === state?.selectedFrameId);
  const canEditLocal = suspended && !!selectedFrame && !selectedFrame.obsolete;
  const localAssignment =
    canEditLocal &&
    localEdit !== null &&
    localEdit.stopId === state?.stopId &&
    localEdit.frameId === state?.selectedFrameId
      ? localEdit.assignment
      : "";
  useEffect(() => {
    setLocalEdit(null);
  }, [canEditLocal, state?.stopId, state?.selectedFrameId]);
  const canSetLocal = canEditLocal && !!localAssignment.trim();
  const currentEvaluation = state?.evaluation;
  const visibleEvaluation =
    !pendingEvaluation &&
    currentEvaluation?.stopId === state?.stopId &&
    currentEvaluation?.frameId === state?.selectedFrameId
      ? currentEvaluation
      : null;
  const split = breakpoint.trim().lastIndexOf(":");
  const className = breakpoint.trim().slice(0, split);
  const line = Number(breakpoint.trim().slice(split + 1));
  const validBreakpoint =
    split > 0 &&
    isJavaBinaryName(className) &&
    Number.isInteger(line) &&
    line > 0 &&
    line <= 2147483647;
  const inspect = (variable: JavaDebuggerVariable) => {
    if (!suspended || !variable.reference) return;
    setInspectedName(variable.name);
    action({ type: "variables", stopId: state!.stopId!, reference: variable.reference, start: 0 });
  };
  return (
    <section
      aria-label="Structured Java debugger"
      className="flex flex-col gap-2 rounded border border-[var(--border-default)] p-2"
    >
      <h3 className="font-semibold">Java debugger</h3>
      <p role="status">
        {state
          ? `JDI: ${state.status}${state.reason ? ` (${state.reason})` : ""}`
          : "Waiting for the JDI debugger…"}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          className={buttonClass}
          disabled={!suspended}
          onClick={() => action({ type: "continue", stopId: state!.stopId! })}
        >
          Continue
        </button>
        <button
          className={buttonClass}
          disabled={!canPause}
          onClick={() => action({ type: "pause" })}
        >
          Pause
        </button>
        {(
          [
            ["Step into", "into"],
            ["Step over", "over"],
            ["Step out", "out"],
          ] as const
        ).map(([label, kind]) => (
          <button
            key={kind}
            className={buttonClass}
            disabled={!canStep || stepFilters === null}
            onClick={() => action({ type: "step", stopId: state!.stopId!, kind,
              ...(stepFilters?.length ? { exclusionFilters: stepFilters } : {}),
            })}
          >
            {label}
          </button>
        ))}
        <button
          className={buttonClass}
          disabled={!suspended || state?.canDropFrame !== true || !state.selectedFrameId}
          onClick={() =>
            action({ type: "dropFrame", stopId: state!.stopId!, frameId: state!.selectedFrameId! })
          }
        >
          Drop frame
        </button>
      </div>
      <label>
        Step exclusion patterns (one per line)
        <textarea className={fieldClass} value={stepFilterText} disabled={!ready}
          placeholder={"java.*\njavax.*\njdk.*"}
          onChange={(event) => onStepFilterTextChange?.(event.target.value)} />
      </label>
      <p className="text-xs">
        These patterns apply to the next Step into, over or out. Use an exact class name or one
        wildcard at the beginning or end, such as java.* or *.Helper (up to 16 patterns and 1,536 UTF-8 bytes in total).
        Explicit breakpoints still stop in excluded classes. Empty patterns preserve ordinary stepping.
      </p>
      {stepFilters === null && <p role="alert">Enter at most 16 class patterns and 1,536 UTF-8 bytes in total, with one optional wildcard at either end.</p>}
      {suspended && state?.canDropFrame === true && (
        <p>
          Drop frame removes the selected call and younger frames, leaving its caller suspended.
          Continue or Step into can call the method again. Object changes and external effects
          remain; finally blocks do not run.
        </p>
      )}
      <button className={buttonClass} disabled={!ready || state?.breakpointsMuted === undefined}
        onClick={() => action({ type: "muteBreakpoints", muted: !state?.breakpointsMuted })}>
        {state?.breakpointsMuted ? "Unmute line breakpoints" : "Mute line breakpoints"}
      </button>
      {state?.breakpointsMuted !== undefined && <p className="text-xs">
        Line breakpoints and logpoints are {state.breakpointsMuted ? "muted" : "active"} for this session.
        Conditions and hit counts are preserved. Exception breakpoints and Run to Cursor remain active.
      </p>}
      <label>
        Breakpoint (class:line)
        <input
          className={fieldClass}
          placeholder="com.example.Main:12"
          value={breakpoint}
          disabled={!ready}
          onChange={(event) => setBreakpoint(event.target.value)}
        />
      </label>
      <div className="flex gap-2">
        <button
          className={buttonClass}
          disabled={!ready || !validBreakpoint || !validOptions}
          onClick={() =>
            action({
              type: "setBreakpoint",
              className,
              line,
              ...(condition ? { condition } : {}),
              ...(matchingHit ? { hitCount: matchingHit } : {}),
              ...(logMessage ? { logMessage } : {}),
            })
          }
        >
          Set breakpoint
        </button>
        <button
          className={buttonClass}
          disabled={!ready || !validBreakpoint}
          onClick={() => action({ type: "clearBreakpoint", className, line })}
        >
          Clear breakpoint
        </button>
      </div>
      <label>
        Breakpoint condition (optional)
        <input
          className={fieldClass}
          value={condition}
          disabled={!ready}
          placeholder="i >= 2 && i % 2 == 0"
          onChange={(event) => setCondition(event.target.value)}
        />
      </label>
      <label>
        Stop on matching hit (optional)
        <input
          className={fieldClass}
          type="number"
          min="0"
          max="1000000000"
          step="1"
          value={hitCount}
          disabled={!ready}
          onChange={(event) => setHitCount(event.target.value)}
        />
      </label>
      <label>
        Log message (optional; makes this a non-suspending logpoint)
        <input
          className={fieldClass}
          value={logMessage}
          disabled={!ready}
          placeholder="i={i}, value={holder.values[0]}"
          onChange={(event) => setLogMessage(event.target.value)}
        />
      </label>
      <p className="text-xs">
        Conditions use the same bounded read-only evaluator described below and read the event
        thread's top frame. A positive hit count stops once on that matching occurrence. Set
        breakpoint resets its counter; a new Debug session starts at zero. A nonempty log message
        resumes without suspending; use {"{expression}"} to interpolate a read-only value from that
        frame. Object values show their type and identity. A failed condition or log expression
        suspends with an error.
      </p>
      {state && (
        <ul aria-label="Java breakpoints">
          {state.breakpoints.map((breakpoint) => (
            <li key={`${breakpoint.sourcePath ?? breakpoint.className}:${breakpoint.line}`}>
              {breakpoint.sourcePath ?? breakpoint.className}:{breakpoint.line}:{" "}
              {breakpoint.verified ? "verified" : "pending"}
              {breakpoint.condition ? ` · condition: ${breakpoint.condition}` : ""}
              {breakpoint.logMessage ? ` · logpoint: ${breakpoint.logMessage}` : ""}
              {` · matching hits: ${breakpoint.hits ?? 0}`}
              {(breakpoint.hitCount ?? 0) > 0
                ? ` · ${breakpoint.logMessage ? "logs" : "stops"} once on ${breakpoint.hitCount}${(breakpoint.hits ?? 0) >= breakpoint.hitCount! ? " (reached; inactive)" : ""}`
                : ""}
              {breakpoint.message ? ` — ${breakpoint.message}` : ""}
            </li>
          ))}
        </ul>
      )}
      <label>
        Exception breakpoints
        <select
          className={fieldClass}
          value={state?.exceptionMode ?? "none"}
          disabled={!ready}
          onChange={(event) =>
            action({
              type: "exceptions",
              mode: event.target.value as JavaDebuggerState["exceptionMode"],
              className: state?.exceptionClassName ?? "",
              includeSubclasses: state?.exceptionIncludeSubclasses ?? true,
            })
          }
        >
          <option value="none">Disabled</option>
          <option value="uncaught">Uncaught exceptions</option>
          <option value="caught">Caught exceptions</option>
          <option value="all">All exceptions</option>
        </select>
      </label>
      <label>
        Exception class (optional binary name)
        <input className={fieldClass} value={exceptionClass} disabled={!ready}
          onChange={(event) => setExceptionClass(event.target.value)} />
      </label>
      <label>
        <input type="checkbox" checked={exceptionSubclasses} disabled={!ready}
          onChange={(event) => setExceptionSubclasses(event.target.checked)} />
        Include exception subclasses
      </label>
      <button className={buttonClass} disabled={!ready || !validExceptionClass}
        onClick={() => action({ type: "exceptions", mode: state?.exceptionMode ?? "none",
          className: exceptionClassName, includeSubclasses: exceptionSubclasses })}>
        Apply exception filter
      </button>
      <p>Leave the class empty to match all exception classes. Use a binary name such as java.io.IOException or Main$Problem; wildcards are unavailable. Apply the filter, then select caught or uncaught exceptions.</p>
      {!validExceptionClass && <p role="alert">Enter a Java binary class name of at most 512 UTF-8 bytes.</p>}
      <p>Current exception filter: {state?.exceptionClassName || "all classes"}{state?.exceptionClassName ? (state.exceptionIncludeSubclasses !== false ? " and subclasses" : " only") : ""}.</p>
      {state && (
        <>
          <label>
            Suspended thread
            <select
              className={fieldClass}
              value={state.selectedThreadId ?? ""}
              disabled={!suspended}
              onChange={(event) =>
                action({
                  type: "selectThread",
                  stopId: state.stopId!,
                  threadId: event.target.value,
                })
              }
            >
              <option value="" disabled>
                Select a suspended thread
              </option>
              {state.threads.map((thread) => (
                <option key={thread.id} value={thread.id} disabled={!thread.suspended}>
                  {thread.name} #{thread.id}
                </option>
              ))}
            </select>
          </label>
          {state.threadsTruncated && (
            <p role="status">
              Only the first 128 threads are shown, including the selected thread.
            </p>
          )}
          <ol aria-label="Java stack frames">
            {state.frames.map((frame) => (
              <li key={frame.id}>
                <button
                  className={buttonClass}
                  disabled={!suspended}
                  aria-pressed={frame.id === state.selectedFrameId}
                  onClick={() =>
                    action({ type: "selectFrame", stopId: state.stopId!, frameId: frame.id })
                  }
                >
                  {frame.className}.{frame.methodName} ({frame.sourcePath ?? "source unavailable"}
                  {frame.line === null ? "" : `:${frame.line}`})
                  {frame.obsolete && " — obsolete method"}
                </button>
              </li>
            ))}
          </ol>
          {state.framesTruncated && <p role="status">Only the first 128 frames are shown.</p>}
          <VariableTable
            label="Java local variables"
            variables={state.variables}
            inspect={inspect}
            disabled={!suspended}
          />
          {state.variablesTruncated && (
            <p role="status">Only the first 128 local variables are shown.</p>
          )}
          <label>
            Watch expression
            <input
              className={fieldClass}
              placeholder="holder.values[0] * 2"
              value={watch}
              disabled={!suspended}
              onChange={(event) => setWatch(event.target.value)}
            />
          </label>
          <button
            className={buttonClass}
            disabled={
              !suspended || !watch.trim() || !!pendingEvaluation || state.watches.length >= 32
            }
            onClick={() =>
              action({ type: "watch", stopId: state.stopId!, expression: watch.trim() })
            }
          >
            Add watch
          </button>
          <button
            className={buttonClass}
            disabled={!suspended || !state.selectedFrameId || !watch.trim() || !!pendingEvaluation}
            onClick={() => {
              const expression = watch.trim();
              setPendingEvaluation({
                expression,
                stopId: state.stopId!,
                frameId: state.selectedFrameId!,
              });
              pendingEvaluationErrorBaseline.current = {
                stateError: state.error,
                commandError: commandError ?? null,
              };
              action({ type: "evaluate", stopId: state.stopId!, expression });
            }}
          >
            Evaluate once
          </button>
          {visibleEvaluation && (
            <section aria-label="Evaluation result">
              <h4>{visibleEvaluation.expression}</h4>
              {visibleEvaluation.error ? (
                <p role="alert">{visibleEvaluation.error}</p>
              ) : visibleEvaluation.variable ? (
                <VariableTable
                  label={`Evaluation ${visibleEvaluation.expression}`}
                  variables={[visibleEvaluation.variable]}
                  inspect={inspect}
                  disabled={!suspended}
                />
              ) : (
                <p role="status">No value was returned for this expression.</p>
              )}
            </section>
          )}
          {pendingEvaluation && <p role="status">Evaluating {pendingEvaluation.expression}…</p>}
          <p className="text-xs">{JAVA_DEBUGGER_EXPRESSION_HELP}</p>
          <label>
            Set local variable
            <input
              className={fieldClass}
              placeholder="value = value + 1"
              value={localAssignment}
              disabled={!canEditLocal}
              onChange={(event) =>
                setLocalEdit({
                  assignment: event.target.value,
                  stopId: state.stopId!,
                  frameId: state.selectedFrameId!,
                })
              }
            />
          </label>
          <button
            className={buttonClass}
            disabled={!canSetLocal || !!pendingEvaluation}
            onClick={() =>
              action({
                type: "setLocalValue",
                stopId: state.stopId!,
                frameId: state.selectedFrameId!,
                assignment: localAssignment.trim(),
              })
            }
          >
            Set local
          </button>
          <p className="text-xs">
            This changes one visible local in the selected current frame. The right-hand side uses
            the bounded evaluator; method calls and field or array assignments are unavailable. The
            assignment draft is cleared when execution resumes or the selected stop or frame
            changes.
          </p>
          <ul aria-label="Java watches">
            {state.watches.map((watch) => (
              <li key={watch.expression}>
                {watch.variable ? (
                  <VariableTable
                    label={`Watch ${watch.expression}`}
                    variables={[watch.variable]}
                    inspect={inspect}
                    disabled={!suspended}
                  />
                ) : (
                  <p>
                    {watch.expression}: {watch.error}
                  </p>
                )}
                <button
                  className={buttonClass}
                  aria-label={`Remove watch ${watch.expression}`}
                  disabled={!suspended}
                  onClick={() =>
                    action({
                      type: "removeWatch",
                      stopId: state.stopId!,
                      expression: watch.expression,
                    })
                  }
                >
                  Remove watch
                </button>
              </li>
            ))}
          </ul>
          {state.variablePage && (
            <section aria-label="Object fields and array elements">
              <h4>
                {inspectedName ? `Inspecting ${inspectedName}` : "Object fields and array elements"}
              </h4>
              <p>
                Showing {state.variablePage.start + 1}–
                {state.variablePage.start + state.variablePage.variables.length} of{" "}
                {state.variablePage.total}
              </p>
              <VariableTable
                label="Java object children"
                variables={state.variablePage.variables}
                inspect={inspect}
                disabled={!suspended}
              />
              <div className="flex gap-2">
                <button
                  className={buttonClass}
                  disabled={!suspended || state.variablePage.start === 0}
                  onClick={() =>
                    action({
                      type: "variables",
                      stopId: state.stopId!,
                      reference: state.variablePage!.reference,
                      start: Math.max(0, state.variablePage!.start - 32),
                    })
                  }
                >
                  Previous children
                </button>
                <button
                  className={buttonClass}
                  disabled={
                    !suspended ||
                    state.variablePage.start + state.variablePage.variables.length >=
                      state.variablePage.total
                  }
                  onClick={() =>
                    action({
                      type: "variables",
                      stopId: state.stopId!,
                      reference: state.variablePage!.reference,
                      start: state.variablePage!.start + state.variablePage!.variables.length,
                    })
                  }
                >
                  Next children
                </button>
              </div>
            </section>
          )}
          {state.message && <p role="status">{state.message}</p>}
          {state.error && <p role="alert">{state.error}</p>}
        </>
      )}
      {commandError && commandError !== state?.error && <p role="alert">{commandError}</p>}
    </section>
  );
}
