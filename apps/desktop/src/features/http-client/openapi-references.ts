type DataRecord = Record<string, unknown>;
function record(value: unknown): DataRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as DataRecord)
    : undefined;
}

/** Resolve only Reference Objects explicitly consumed by the importer, never example payload data. */
export function localOpenApiReferences(document: unknown) {
  let references = 0;
  return (
    input: unknown,
    kind: "pathItem" | "requestBody" | "example" | "parameter",
  ): DataRecord | undefined => {
    let value = record(input);
    const seen = new Set<DataRecord>();
    while (value && Object.hasOwn(value, "$ref")) {
      if (seen.has(value)) throw new Error("The OpenAPI reference chain contains a cycle.");
      seen.add(value);
      if (seen.size > 32 || ++references > 4096)
        throw new Error("OpenAPI reference resolution exceeded its limit.");
      if (
        kind === "pathItem" &&
        Object.keys(value).some((key) => !["$ref", "summary", "description"].includes(key))
      ) {
        throw new Error(
          "Referenced OpenAPI paths cannot also define local operations or settings.",
        );
      }
      const reference = value.$ref;
      if (typeof reference !== "string" || !reference.startsWith("#") || reference.length > 4096)
        throw new Error("OpenAPI route and example references must be local JSON Pointers.");
      let pointer: string;
      try {
        pointer = decodeURIComponent(reference.slice(1));
      } catch {
        throw new Error("The OpenAPI reference has an invalid URI fragment.");
      }
      if (pointer !== "" && !pointer.startsWith("/"))
        throw new Error("OpenAPI references require a JSON Pointer fragment.");
      const tokens = pointer === "" ? [] : pointer.slice(1).split("/");
      if (tokens.length > 128) throw new Error("The OpenAPI reference is too deeply nested.");
      let target: unknown = document;
      for (const token of tokens) {
        if (/~(?:[^01]|$)/u.test(token))
          throw new Error("The OpenAPI reference has an invalid JSON Pointer escape.");
        const key = token.replace(/~1/gu, "/").replace(/~0/gu, "~");
        if (
          target === null ||
          typeof target !== "object" ||
          !Object.hasOwn(target, key) ||
          (Array.isArray(target) && !/^(?:0|[1-9][0-9]*)$/u.test(key))
        )
          throw new Error("The OpenAPI reference target was not found in this document.");
        target = (target as DataRecord)[key];
      }
      value = record(target);
      if (!value) throw new Error("The OpenAPI reference must identify an object.");
    }
    if (seen.size && kind === "requestBody" && !record(value?.content))
      throw new Error("The OpenAPI reference does not identify a request body with content.");
    return value;
  };
}
