import { useEffect, useState } from "react";
import { HttpCollectionTransfer } from "./HttpCollectionTransfer";
import { normalizeHttpLibrary, type HttpSavedRequest } from "@ide/contracts";
import type { HttpRequestDraft } from "./HttpClientPanel";
import type { useHttpClientLibrary } from "./useHttpClientLibrary";

interface Props {
  collections: ReturnType<typeof useHttpClientLibrary>;
  draft: HttpRequestDraft;
  onLoad(request: HttpRequestDraft): void;
  environmentName: string;
  onEnvironmentChange(name: string): void;
  workspaceId: string | null;
  generation: number;
}
const identity = (request: HttpSavedRequest) => JSON.stringify([request.collection, request.name]);
const inputClass =
  "rounded border border-[var(--border-default)] bg-[var(--surface-primary)] px-2 py-1 text-xs";
const buttonClass =
  "rounded border border-[var(--border-default)] px-2 py-1 text-xs disabled:opacity-50";

export function HttpCollectionsPanel({
  collections,
  draft,
  onLoad,
  onEnvironmentChange,
  environmentName: selectedEnvironment,
  workspaceId,
  generation,
}: Props) {
  const [selected, setSelected] = useState("");
  const [collection, setCollection] = useState("Requests");
  const [name, setName] = useState("");
  const environment = selectedEnvironment;
  const setEnvironment = onEnvironmentChange;
  const [environmentName, setEnvironmentName] = useState("");
  const [variables, setVariables] = useState("{}");
  const [error, setError] = useState<string | null>(null);
  const { library } = collections;
  const disabled = !collections.available || collections.busy || !collections.revision;
  useEffect(() => {
    setSelected("");
    setCollection("Requests");
    setName("");
    setEnvironmentName("");
    setVariables("{}");
    setError(null);
  }, [workspaceId, generation]);
  async function saveRequest() {
    setError(null);
    try {
      const entry = { collection: collection.trim(), name: name.trim(), ...draft };
      const next = normalizeHttpLibrary({
        ...library,
        requests: [
          ...library.requests.filter((request) => identity(request) !== identity(entry)),
          entry,
        ],
      });
      if (await collections.save(next)) setSelected(identity(entry));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Cannot save this request.");
    }
  }
  async function saveEnvironment() {
    setError(null);
    try {
      const entry = { name: environmentName.trim(), variables: JSON.parse(variables) as unknown };
      const next = normalizeHttpLibrary({
        ...library,
        environments: [...library.environments.filter((value) => value.name !== entry.name), entry],
      });
      if (await collections.save(next)) setEnvironment(entry.name);
    } catch {
      setError(
        "Enter an environment name and a JSON object of up to 64 variable names with string values. Nothing was saved.",
      );
    }
  }
  return (
    <details className="shrink-0 rounded border border-[var(--border-default)] p-2">
      <summary className="cursor-pointer text-xs font-semibold text-[var(--text-secondary)]">
        Saved requests and environments
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <p className="text-xs text-[var(--text-secondary)]">
          Saved locally for this workspace. Responses are not saved. Use {"{{variable}}"} in URLs,
          header values or bodies; values are substituted only when you send.
        </p>
        <div className="flex flex-wrap gap-2">
          <select
            aria-label="Saved HTTP request"
            className={inputClass}
            value={selected}
            disabled={disabled}
            onChange={(event) => {
              const selected = event.currentTarget.value;
              setSelected(selected);
              const entry = library.requests.find((entry) => identity(entry) === selected);
              if (entry) {
                setCollection(entry.collection);
                setName(entry.name);
                onLoad(entry);
              }
            }}
          >
            <option value="">Select a saved request</option>
            {library.requests.map((entry) => (
              <option key={identity(entry)} value={identity(entry)}>
                {entry.collection} / {entry.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={buttonClass}
            disabled={!collections.available || collections.busy}
            onClick={() => {
              void collections.reload();
            }}
          >
            Reload collections
          </button>
          <button
            type="button"
            className={buttonClass}
            disabled={disabled || !library.requests.some((entry) => identity(entry) === selected)}
            onClick={async () => {
              if (
                await collections.save({
                  ...library,
                  requests: library.requests.filter((entry) => identity(entry) !== selected),
                })
              )
                setSelected("");
            }}
          >
            Delete saved request
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            aria-label="HTTP collection name"
            className={inputClass}
            maxLength={128}
            value={collection}
            onChange={(event) => setCollection(event.currentTarget.value)}
            placeholder="Collection"
          />
          <input
            aria-label="HTTP request name"
            className={inputClass}
            maxLength={128}
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            placeholder="Request name"
          />
          <button
            type="button"
            className={buttonClass}
            disabled={disabled || !collection.trim() || !name.trim() || !draft.url.trim()}
            onClick={() => {
              void saveRequest();
            }}
          >
            Save request
          </button>
        </div>
        <label className="flex flex-wrap items-center gap-2 text-xs">
          Environment
          <select
            aria-label="HTTP environment"
            className={inputClass}
            value={environment}
            disabled={disabled}
            onChange={(event) => {
              const name = event.currentTarget.value;
              setEnvironment(name);
              const entry = library.environments.find((entry) => entry.name === name);
              setEnvironmentName(entry?.name ?? "");
              setVariables(JSON.stringify(entry?.variables ?? {}, null, 2));
              setError(null);
            }}
          >
            <option value="">No environment</option>
            {library.environments.map((entry) => (
              <option key={entry.name} value={entry.name}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
        <details>
          <summary className="cursor-pointer text-xs">Edit environments</summary>
          <div className="mt-2 flex flex-col gap-2">
            <input
              aria-label="HTTP environment name"
              className={inputClass}
              maxLength={128}
              value={environmentName}
              onChange={(event) => setEnvironmentName(event.currentTarget.value)}
              placeholder="Environment name"
            />
            <textarea
              aria-label="HTTP environment variables"
              className={`${inputClass} min-h-20 font-mono`}
              maxLength={2 * 1024 * 1024}
              value={variables}
              spellCheck={false}
              onChange={(event) => setVariables(event.currentTarget.value)}
              placeholder={'{"baseUrl":"http://localhost:8080"}'}
            />
            <div className="flex gap-2">
              <button
                type="button"
                className={buttonClass}
                disabled={disabled || !environmentName.trim()}
                onClick={() => {
                  void saveEnvironment();
                }}
              >
                Save environment
              </button>
              <button
                type="button"
                className={buttonClass}
                disabled={disabled || !environment}
                onClick={async () => {
                  if (
                    await collections.save({
                      ...library,
                      environments: library.environments.filter(
                        (entry) => entry.name !== environment,
                      ),
                    })
                  ) {
                    setEnvironment("");
                    setEnvironmentName("");
                    setVariables("{}");
                  }
                }}
              >
                Delete environment
              </button>
            </div>
          </div>
        </details>
        <HttpCollectionTransfer key={JSON.stringify([workspaceId, generation])} collections={collections} workspaceId={workspaceId} generation={generation} />
        {collections.busy ? (
          <p role="status" className="text-xs">
            Loading or saving HTTP collections…
          </p>
        ) : null}
        {!collections.available ? (
          <p className="text-xs">Saved HTTP collections are unavailable for this workspace.</p>
        ) : null}
        {collections.error || error ? (
          <p
            role="alert"
            aria-label="HTTP collections error"
            className="text-xs text-[var(--text-danger)]"
          >
            {error ?? collections.error}
          </p>
        ) : null}
      </div>
    </details>
  );
}
