import { normalizeHttpLibrary, type HttpRequestLibrary } from "@ide/contracts";

export const MAX_HTTP_COLLECTION_TRANSFER_BYTES = 2 * 1024 * 1024;
export type HttpImportConflictPolicy = "keep" | "replace";
const requestKey = (entry: HttpRequestLibrary["requests"][number]) => JSON.stringify([entry.collection, entry.name]);

export function exportHttpCollections(library: HttpRequestLibrary): string {
  return JSON.stringify(normalizeHttpLibrary(library));
}

/** The portable document contains templates, never resolved values, responses or workspace identity. */
export function reviewHttpCollectionImport(source: string, saved: HttpRequestLibrary, policy: HttpImportConflictPolicy) {
  if (new TextEncoder().encode(source).length > MAX_HTTP_COLLECTION_TRANSFER_BYTES)
    throw new Error("HTTP collection imports are limited to 2 MiB.");
  let value: unknown;
  try { value = JSON.parse(source); }
  catch { throw new Error("Enter a valid HTTP collections JSON document."); }
  const incoming = normalizeHttpLibrary(value);
  const current = normalizeHttpLibrary(saved);
  const requests = new Map(current.requests.map((entry) => [requestKey(entry), entry]));
  const environments = new Map(current.environments.map((entry) => [entry.name, entry]));
  const counts = { addedRequests: 0, matchingRequests: 0, addedEnvironments: 0, matchingEnvironments: 0 };
  for (const entry of incoming.requests) {
    const key = requestKey(entry), exists = requests.has(key);
    if (exists) counts.matchingRequests++; else counts.addedRequests++;
    if (!exists || policy === "replace") requests.set(key, entry);
  }
  for (const entry of incoming.environments) {
    const exists = environments.has(entry.name);
    if (exists) counts.matchingEnvironments++; else counts.addedEnvironments++;
    if (!exists || policy === "replace") environments.set(entry.name, entry);
  }
  return {
    ...counts,
    policy,
    library: normalizeHttpLibrary({ version: 1, requests: [...requests.values()], environments: [...environments.values()] }),
  };
}
