import type { HttpRequestHeader } from "@ide/contracts";
import type { localOpenApiReferences } from "./openapi-references";

export interface OpenApiParameter {
  key: string;
  name: string;
  location: "path" | "query" | "header" | "cookie";
  required: boolean;
  style: string;
  explode: boolean;
  allowReserved: boolean;
  content?: "application/json" | "text/plain";
  initial: { enabled: boolean; format: "text" | "json"; text: string };
}
export type OpenApiParameterValue = OpenApiParameter["initial"];
type RecordData = Record<string, unknown>;
const encoder = new TextEncoder();
const record = (value: unknown): RecordData | undefined =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
    ? (value as RecordData)
    : undefined;
const bytes = (value: string) => encoder.encode(value).length;
const token = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u;
const scalar = (value: unknown): value is string | number | boolean =>
  typeof value === "string" ||
  typeof value === "boolean" ||
  (typeof value === "number" &&
    Number.isFinite(value) &&
    (!Number.isInteger(value) || Number.isSafeInteger(value)));

function jsonText(value: unknown): string {
  const pending: [unknown, number][] = [[value, 0]];
  let nodes = 0,
    outputBytes = 0;
  const stringBytes = (text: string) => {
    if (bytes(text) > 8192) throw new Error("OpenAPI parameter values are limited to 8 KiB.");
    return bytes(JSON.stringify(text));
  };
  while (pending.length) {
    const [item, depth] = pending.pop()!;
    if (++nodes > 4096 || depth > 32)
      throw new Error("OpenAPI parameter JSON exceeds its nesting or value limit.");
    if (item === null || scalar(item)) {
      outputBytes += typeof item === "string" ? stringBytes(item) : JSON.stringify(item).length;
    } else {
      if (!Array.isArray(item) && !record(item))
        throw new Error(
          "OpenAPI parameters require finite JSON values and safe-range integers; use Text for larger integers.",
        );
      const children = Array.isArray(item) ? item : Object.values(item as RecordData);
      if (children.length > 128)
        throw new Error("OpenAPI parameter arrays and objects are limited to 128 entries.");
      outputBytes += 2 + Math.max(0, children.length - 1);
      if (!Array.isArray(item))
        for (const key of Object.keys(item as RecordData)) outputBytes += stringBytes(key) + 1;
      for (const child of children) pending.push([child, depth + 1]);
    }
    if (outputBytes > 8192) throw new Error("OpenAPI parameter values are limited to 8 KiB.");
  }
  const text = JSON.stringify(value);
  if (typeof text !== "string" || bytes(text) > 8192)
    throw new Error("OpenAPI parameter values are limited to 8 KiB.");
  return text;
}

/** Normalize explicit Parameter Objects only; this does not evaluate JSON Schema. */
export function openApiParameterReader(resolve: ReturnType<typeof localOpenApiReferences>) {
  const cache = new Map<RecordData, OpenApiParameter | null>();
  let retainedBytes = 0;
  function parameter(input: unknown): OpenApiParameter | null {
    const data = resolve(input, "parameter");
    if (!data) throw new Error("An OpenAPI parameter must be an object.");
    if (cache.has(data)) return cache.get(data)!;
    const { name, in: location } = data;
    if (
      typeof name !== "string" ||
      !name ||
      bytes(name) > 256 ||
      /[\p{Cc}]/u.test(name) ||
      !["path", "query", "header", "cookie"].includes(location as string)
    )
      throw new Error("OpenAPI parameters need a bounded name and a valid location.");
    if (
      location === "header" &&
      ["accept", "content-type", "authorization"].includes(name.toLowerCase())
    ) {
      cache.set(data, null);
      return null;
    }
    if (location === "header" && (!token.test(name) || name.toLowerCase() === "cookie"))
      throw new Error(
        "OpenAPI header parameters need HTTP token names; use in: cookie for cookies.",
      );
    if (
      (data.required !== undefined && typeof data.required !== "boolean") ||
      (data.explode !== undefined && typeof data.explode !== "boolean") ||
      (data.allowReserved !== undefined && typeof data.allowReserved !== "boolean")
    )
      throw new Error("OpenAPI parameter flags must be booleans.");
    if (location === "path" && data.required !== true)
      throw new Error("OpenAPI path parameters must declare required: true.");
    const schema = record(data.schema);
    const content = record(data.content);
    if (Boolean(schema) === Boolean(content))
      throw new Error("OpenAPI parameters need exactly one schema or content object.");
    let media: OpenApiParameter["content"];
    let mediaObject: RecordData | undefined;
    if (content) {
      const types = Object.keys(content);
      if (types.length !== 1 || !["application/json", "text/plain"].includes(types[0]!))
        throw new Error(
          "OpenAPI parameter content supports one application/json or text/plain representation.",
        );
      media = types[0] as OpenApiParameter["content"];
      mediaObject = record(content[types[0]!]);
      if (!mediaObject || (location === "cookie" && media !== "text/plain"))
        throw new Error("Cookie parameter content supports text/plain only.");
      if (["style", "explode", "allowReserved"].some((key) => Object.hasOwn(data, key)))
        throw new Error(
          "Content-based OpenAPI parameters cannot also declare style serialization.",
        );
    }
    const style = data.style ?? (location === "query" || location === "cookie" ? "form" : "simple");
    const allowed =
      location === "path"
        ? ["simple", "label", "matrix"]
        : location === "query"
          ? ["form", "spaceDelimited", "pipeDelimited", "deepObject"]
          : location === "header"
            ? ["simple"]
            : ["form"];
    if (typeof style !== "string" || !allowed.includes(style))
      throw new Error("Unsupported OpenAPI parameter style for its location.");
    const explode = data.explode === undefined ? style === "form" : (data.explode as boolean);
    if (
      !media &&
      ((style === "deepObject" && !explode) ||
        (["spaceDelimited", "pipeDelimited"].includes(style) && explode))
    )
      throw new Error(
        "The declared OpenAPI style/explode combination has no defined serialization.",
      );
    if (data.allowReserved === true && location !== "query")
      throw new Error("allowReserved is supported only for query parameters.");
    const exampleSource = mediaObject ?? data;
    let example = exampleSource.example;
    if (example !== undefined && exampleSource.examples !== undefined)
      throw new Error("OpenAPI example and examples are mutually exclusive.");
    if (example === undefined && exampleSource.examples !== undefined) {
      const examples = record(exampleSource.examples);
      if (!examples) throw new Error("OpenAPI parameter examples must be an object.");
      const first = Object.values(examples)[0];
      if (first !== undefined) example = resolve(first, "example")?.value;
    }
    const inlineSchema = record(mediaObject?.schema) ?? schema;
    if (example === undefined) {
      example =
        inlineSchema && Object.hasOwn(inlineSchema, "example")
          ? inlineSchema.example
          : inlineSchema?.default;
    }
    const format =
      media === "application/json" ||
      (example !== undefined && typeof example !== "string") ||
      example === "" ||
      ["array", "object", "number", "integer", "boolean"].includes(inlineSchema?.type as string)
        ? "json"
        : "text";
    const text =
      example === undefined ? "" : format === "json" ? jsonText(example) : String(example);
    if (bytes(text) > 8192) throw new Error("OpenAPI parameter values are limited to 8 KiB.");
    retainedBytes += bytes(text) + bytes(name);
    if (retainedBytes > 4 * 1024 * 1024)
      throw new Error("OpenAPI parameter defaults exceed the 4 MiB retained limit.");
    const result: OpenApiParameter = {
      key: JSON.stringify([location, location === "header" ? name.toLowerCase() : name]),
      name,
      location: location as OpenApiParameter["location"],
      required: data.required === true,
      style,
      explode,
      allowReserved: data.allowReserved === true,
      ...(media ? { content: media } : {}),
      initial: { enabled: data.required === true || example !== undefined, format, text },
    };
    cache.set(data, result);
    return result;
  }
  function list(input: unknown): OpenApiParameter[] {
    if (input === undefined) return [];
    if (!Array.isArray(input) || input.length > 64)
      throw new Error("OpenAPI parameter lists are limited to 64 entries.");
    const seen = new Set<string>();
    const result: OpenApiParameter[] = [];
    for (const inputParameter of input) {
      const value = parameter(inputParameter);
      if (!value) continue;
      if (seen.has(value.key))
        throw new Error("An OpenAPI parameter list contains duplicate names and locations.");
      seen.add(value.key);
      result.push(value);
    }
    return result;
  }
  return (
    pathParameters: unknown,
    operationParameters: unknown,
    path: string,
  ): OpenApiParameter[] => {
    const merged = new Map(list(pathParameters).map((value) => [value.key, value]));
    for (const value of list(operationParameters)) merged.set(value.key, value);
    if (merged.size > 64)
      throw new Error("OpenAPI operations are limited to 64 effective parameters.");
    const result = [...merged.values()];
    for (const value of result)
      if (value.location === "path" && !path.includes(`{${value.name}}`))
        throw new Error("An OpenAPI path parameter does not match its path template.");
    for (const match of path.matchAll(/\{([^{}]+)\}/gu)) {
      if (!result.some((value) => value.location === "path" && value.name === match[1]))
        throw new Error(`OpenAPI path template ${match[1]} needs a declared required parameter.`);
    }
    return result;
  };
}

function encode(value: string, reserved = false): string {
  try {
    const strict = (text: string) =>
      encodeURIComponent(text).replace(
        /[!'()*]/gu,
        (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
      );
    if (!reserved) return strict(value);
    // Keep legal query reserved characters and existing percent triples, but protect
    // query separators, fragments, plus signs and serialization delimiters.
    return value
      .split(/(%[0-9a-f]{2})/giu)
      .map((part) =>
        /^%[0-9a-f]{2}$/iu.test(part)
          ? part
          : strict(part).replace(/%(3A|2F|3F|40|21|24|27|28|29|2A|3B)/giu, (code) =>
              String.fromCharCode(parseInt(code.slice(1), 16)),
            ),
      )
      .join("");
  } catch {
    throw new Error("OpenAPI parameter text must contain valid Unicode.");
  }
}

export function prepareOpenApiParameters(
  operation: { url: string; path: string; parameters?: OpenApiParameter[] },
  values: readonly OpenApiParameterValue[],
): { url: string; headers: HttpRequestHeader[] } {
  const parameters = operation.parameters ?? [];
  if (parameters.length !== values.length)
    throw new Error("The OpenAPI parameter selection changed. Select the operation again.");
  const pathValues = new Map<string, string>();
  const query: string[] = [],
    headers: HttpRequestHeader[] = [],
    cookies: string[] = [];
  for (let index = 0; index < parameters.length; index++) {
    const parameter = parameters[index]!,
      input = values[index]!;
    if (!input.enabled && !parameter.required) continue;
    if (!input.enabled || (parameter.required && !input.text.length))
      throw new Error(`Enter the required ${parameter.location} parameter ${parameter.name}.`);
    if (bytes(input.text) > 8192) throw new Error("OpenAPI parameter values are limited to 8 KiB.");
    let value: unknown = input.text;
    if (input.format === "json") {
      try {
        value = JSON.parse(input.text);
      } catch {
        throw new Error(`Parameter ${parameter.name} needs valid JSON.`);
      }
      jsonText(value);
    }
    if (parameter.content === "application/json") value = jsonText(value);
    else if (parameter.content === "text/plain" && typeof value !== "string")
      throw new Error(`Parameter ${parameter.name} needs text.`);
    else if (
      value === null ||
      (Array.isArray(value) && !value.length) ||
      (record(value) && !Object.keys(value as RecordData).length)
    ) {
      if (parameter.required)
        throw new Error(`Required parameter ${parameter.name} has an undefined value.`);
      continue;
    }
    const atom = (input: unknown) => {
      if (!scalar(input))
        throw new Error(
          "Style-based OpenAPI parameters support scalars, flat arrays and flat objects only.",
        );
      return encode(String(input), parameter.allowReserved);
    };
    const object = record(value);
    const parts = Array.isArray(value)
      ? value.map(atom)
      : object
        ? Object.entries(object).map(([key, item]) => [atom(key), atom(item)])
        : undefined;
    const flat = parts?.flat() as string[] | undefined;
    const pairs = object ? (parts as string[][]) : undefined;
    const name = encode(parameter.name);
    let serialized: string;
    if (parameter.content)
      serialized =
        parameter.location === "header" || parameter.location === "cookie"
          ? String(value)
          : encode(String(value));
    else if (parameter.style === "deepObject") {
      if (!pairs) throw new Error("deepObject parameters require a flat object.");
      query.push(...pairs.map(([key, item]) => `${name}%5B${key}%5D=${item}`));
      continue;
    } else if (["spaceDelimited", "pipeDelimited"].includes(parameter.style)) {
      if (!flat) throw new Error("Delimited query parameters require an array or flat object.");
      serialized = flat.join(parameter.style === "spaceDelimited" ? "%20" : "%7C");
    } else if (
      parameter.location === "query" &&
      parameter.style === "form" &&
      parameter.explode &&
      flat
    ) {
      query.push(
        ...(pairs
          ? pairs.map(([key, item]) => `${key}=${item}`)
          : flat.map((item) => `${name}=${item}`)),
      );
      continue;
    } else if (parameter.style === "label")
      serialized =
        "." +
        (pairs && parameter.explode
          ? pairs.map(([key, item]) => `${key}=${item}`).join(".")
          : flat
            ? flat.join(parameter.explode ? "." : ",")
            : atom(value));
    else if (parameter.style === "matrix")
      serialized =
        flat && parameter.explode
          ? pairs
            ? pairs.map(([key, item]) => `;${key}=${item}`).join("")
            : flat.map((item) => `;${name}=${item}`).join("")
          : `;${name}=${flat ? flat.join(",") : atom(value)}`;
    else
      serialized =
        pairs && parameter.explode
          ? pairs.map(([key, item]) => `${key}=${item}`).join(",")
          : flat
            ? flat.join(",")
            : atom(value);
    if (parameter.location === "path") pathValues.set(parameter.name, serialized);
    else if (parameter.location === "query") query.push(`${name}=${serialized}`);
    else if (parameter.location === "header") {
      if (/[\u0000-\u0008\u000a-\u001f\u007f]/u.test(serialized))
        throw new Error("OpenAPI header values cannot contain control characters.");
      headers.push({ name: parameter.name, value: serialized });
    } else {
      if (flat)
        throw new Error("OpenAPI cookies support scalar form values or text/plain content only.");
      if (!/^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*$/u.test(serialized))
        throw new Error(
          "Cookie text must contain cookie-safe ASCII characters; use scalar form serialization for other text.",
        );
      cookies.push(`${name}=${serialized}`);
    }
  }
  const path = operation.path.replace(/\{([^{}]+)\}/gu, (_match, name: string) => {
    const value = pathValues.get(name);
    if (value === undefined) throw new Error(`Provide the required path parameter ${name}.`);
    return value;
  });
  if (/[{}?#]/u.test(path) || path.split("/").some((part) => /^(?:\.|%2e){1,2}$/iu.test(part)))
    throw new Error(
      "Prepared OpenAPI paths cannot contain unresolved templates, query/fragment delimiters or dot segments.",
    );
  if (!operation.url.endsWith(operation.path))
    throw new Error("The OpenAPI operation URL changed.");
  const url =
    operation.url.slice(0, -operation.path.length) +
    path +
    (query.length ? "?" + query.join("&") : "");
  if (bytes(url) > 8192)
    throw new Error("The prepared OpenAPI URL exceeds the 8 KiB request limit.");
  if (cookies.length) headers.push({ name: "Cookie", value: cookies.join("; ") });
  if (
    headers.length > 64 ||
    headers.reduce((total, header) => total + bytes(header.name) + bytes(header.value), 0) >
      64 * 1024
  )
    throw new Error("Prepared OpenAPI headers exceed the request limits.");
  return { url, headers };
}
