import { useState } from "react";
import type { OpenApiHttpOperation } from "./openapi";
import { prepareOpenApiParameters, type OpenApiParameterValue } from "./openapi-parameters";

export function OpenApiParameterForm({
  operation,
  disabled,
  prepared,
  onEdit,
  onPrepared,
}: {
  operation: OpenApiHttpOperation;
  disabled: boolean;
  prepared: boolean;
  onEdit(): void;
  onPrepared(value: ReturnType<typeof prepareOpenApiParameters>): void;
}) {
  const [values, setValues] = useState<OpenApiParameterValue[]>(() =>
    operation.parameters!.map((value) => ({ ...value.initial })),
  );
  const [error, setError] = useState<string | null>(null);
  function update(index: number, value: Partial<OpenApiParameterValue>) {
    setValues((current) =>
      current.map((entry, position) => (position === index ? { ...entry, ...value } : entry)),
    );
    setError(null);
    onEdit();
  }
  return (
    <fieldset
      disabled={disabled}
      aria-label="OpenAPI request parameters"
      className="space-y-2 rounded border border-[var(--border-default)] p-2 text-xs"
    >
      <legend>Operation parameters</legend>
      <p>
        Enter values, then choose Prepare request. JSON accepts scalars, arrays and objects; use
        JSON {`""`} for an explicit empty string. Schema constraints are not validated. Preparation
        never sends a request.
      </p>
      {operation.parameters!.map((parameter, index) => (
        <div key={parameter.key} className="flex flex-wrap items-center gap-2">
          <label>
            <input
              type="checkbox"
              aria-label={`Include OpenAPI ${parameter.location} ${parameter.name}`}
              checked={values[index]!.enabled}
              disabled={parameter.required}
              onChange={(event) => update(index, { enabled: event.target.checked })}
            />{" "}
            {parameter.location}: {parameter.name}
            {parameter.required ? " (required)" : ""}
          </label>
          <label>
            Format{" "}
            <select
              aria-label={`OpenAPI format ${parameter.location} ${parameter.name}`}
              value={values[index]!.format}
              onChange={(event) => update(index, { format: event.target.value as "text" | "json" })}
            >
              <option value="text">Text</option>
              <option value="json">JSON</option>
            </select>
          </label>
          <input
            aria-label={`OpenAPI value ${parameter.location} ${parameter.name}`}
            className="min-w-40 flex-1 rounded border border-[var(--border-default)] bg-[var(--surface-primary)] p-1"
            value={values[index]!.text}
            maxLength={8192}
            disabled={!values[index]!.enabled}
            onChange={(event) => update(index, { text: event.target.value })}
          />
          <span>
            {parameter.content ?? `${parameter.style}${parameter.explode ? ", explode" : ""}`}
          </span>
        </div>
      ))}
      <button
        type="button"
        className="rounded border border-[var(--border-default)] px-2 py-1"
        onClick={() => {
          setError(null);
          try {
            onPrepared(prepareOpenApiParameters(operation, values));
          } catch (error) {
            setError(
              error instanceof Error ? error.message : "Could not prepare OpenAPI parameters.",
            );
          }
        }}
      >
        Prepare request
      </button>
      <p role="status">
        {prepared
          ? "Parameters copied to the editable request. Review it before Send."
          : "Prepare these parameters before Send. The request draft has not been replaced."}
      </p>
      {error && (
        <p role="alert" aria-label="OpenAPI parameter error">
          {error}
        </p>
      )}
    </fieldset>
  );
}
