import { parse } from "yaml";
import type { HttpRequestMethod } from "@ide/contracts";
import { openApiParameterReader, type OpenApiParameter } from "./openapi-parameters";
import { localOpenApiReferences } from "./openapi-references";

export const MAX_OPENAPI_DOCUMENT_BYTES = 1024 * 1024;
const MAX_OPENAPI_OPERATIONS = 200;
const MAX_OPENAPI_PATH_BYTES = 512;
const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

export interface OpenApiHttpOperation {
  id: string;
  label: string;
  method: HttpRequestMethod;
  path: string;
  url: string;
  parameters?: OpenApiParameter[];
  contentType?: string;
  body?: string;
}

type DataRecord = Record<string, unknown>;

function record(value: unknown): DataRecord | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as DataRecord;
}

function stringValue(value: unknown, maximumLength: number): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength
    ? value
    : undefined;
}

function resolveServer(server: unknown): string {
  const value = record(server);
  const rawUrl = stringValue(value?.url, 2048);
  if (!rawUrl) throw new Error("The OpenAPI document must define an HTTP or HTTPS server URL.");
  const variables = record(value?.variables);
  const expanded = rawUrl.replace(/\{([^{}]+)\}/gu, (_match, name: string) => {
    const variable = record(variables?.[name]);
    const defaultValue = stringValue(variable?.default, 512);
    if (!defaultValue) throw new Error("OpenAPI server variables need default values.");
    return defaultValue;
  });
  let parsed: URL;
  try {
    parsed = new URL(expanded);
  } catch {
    throw new Error("The OpenAPI server URL must be absolute.");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    !parsed.hostname ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    throw new Error(
      "Only absolute HTTP or HTTPS OpenAPI server URLs without credentials are supported.",
    );
  }
  return expanded.replace(/\/+$/u, "");
}

function requestBody(
  operation: DataRecord,
  resolve: ReturnType<typeof localOpenApiReferences>,
  serialize: (example: unknown) => string,
): Pick<OpenApiHttpOperation, "contentType" | "body"> {
  const requestBody = resolve(operation.requestBody, "requestBody");
  const content = record(requestBody?.content);
  const json = record(content?.["application/json"]);
  if (!json) return {};

  let example = json.example;
  if (example === undefined) {
    const examples = record(json.examples);
    const firstExample = examples ? Object.values(examples)[0] : undefined;
    example = resolve(firstExample, "example")?.value;
  }
  if (example === undefined) example = record(json.schema)?.default;
  if (example === undefined) return { contentType: "application/json" };

  return { contentType: "application/json", body: serialize(example) };
}

export function parseOpenApiOperations(source: string): OpenApiHttpOperation[] {
  if (new TextEncoder().encode(source).byteLength > MAX_OPENAPI_DOCUMENT_BYTES) {
    throw new Error("OpenAPI documents are limited to 1 MiB.");
  }

  let document: unknown;
  try {
    document = parse(source, { uniqueKeys: true, maxAliasCount: 100 });
  } catch {
    throw new Error("The OpenAPI document is not valid JSON or YAML.");
  }
  const root = record(document);
  const version = stringValue(root?.openapi, 32);
  if (!version || !/^3\.(?:0|1)\.\d+(?:[-+].*)?$/u.test(version)) {
    throw new Error("Only OpenAPI 3.0 and 3.1 documents are supported.");
  }
  const rootServers = Array.isArray(root?.servers) ? root.servers : [];
  const paths = record(root?.paths);
  if (!paths) throw new Error("The OpenAPI document does not contain a paths object.");

  const operations: OpenApiHttpOperation[] = [];
  const resolve = localOpenApiReferences(document);
  const readParameters = openApiParameterReader(resolve);
  const examples = new Map<unknown, string>();
  let exampleBytes = 0;
  const serialize = (example: unknown): string => {
    const cached = examples.get(example);
    if (cached !== undefined) return cached;
    let body: string;
    try {
      body = JSON.stringify(example, null, 2);
    } catch {
      throw new Error("The OpenAPI JSON request example cannot be represented as JSON.");
    }
    const bytes = new TextEncoder().encode(body).byteLength;
    if (bytes > 1024 * 1024) throw new Error("OpenAPI request examples are limited to 1 MiB each.");
    if (exampleBytes + bytes > 4 * 1024 * 1024)
      throw new Error("OpenAPI request examples are limited to 4 MiB of distinct expanded bodies.");
    examples.set(example, body);
    exampleBytes += bytes;
    return body;
  };
  for (const [path, pathItemValue] of Object.entries(paths)) {
    if (
      !path.startsWith("/") ||
      path.length > MAX_OPENAPI_PATH_BYTES ||
      /[\u0000-\u001f\u007f]/u.test(path) ||
      path.split("/").some((segment) => segment === "." || segment === "..")
    ) {
      continue;
    }
    const pathItem = resolve(pathItemValue, "pathItem");
    if (!pathItem) continue;
    for (const methodKey of HTTP_METHODS) {
      const operation = record(pathItem[methodKey]);
      if (!operation) continue;
      if (operations.length >= MAX_OPENAPI_OPERATIONS) {
        throw new Error(`OpenAPI documents are limited to ${MAX_OPENAPI_OPERATIONS} operations.`);
      }
      const operationServers = Array.isArray(operation.servers) ? operation.servers : [];
      const pathServers = Array.isArray(pathItem.servers) ? pathItem.servers : [];
      const server = resolveServer(operationServers[0] ?? pathServers[0] ?? rootServers[0]);
      const url = `${server}${path}`;
      try {
        const parsedUrl = new URL(url);
        if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") continue;
      } catch {
        continue;
      }
      const method = methodKey.toUpperCase() as HttpRequestMethod;
      const summary = stringValue(operation.summary, 256);
      const details = requestBody(operation, resolve, serialize);
      const parameters = readParameters(pathItem.parameters, operation.parameters, path);
      operations.push({
        id: `${methodKey}:${path}`,
        label: `${method} ${path}${summary ? ` — ${summary}` : ""}`,
        method,
        path,
        url,
        ...details,
        ...(parameters.length ? { parameters } : {}),
      });
    }
  }

  if (operations.length === 0)
    throw new Error("The OpenAPI document contains no supported operations.");
  return operations;
}
