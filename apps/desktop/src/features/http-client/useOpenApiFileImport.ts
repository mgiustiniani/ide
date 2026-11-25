import { useBoundedTextFileImport } from "../files/useBoundedTextFileImport";
import { MAX_OPENAPI_DOCUMENT_BYTES } from "./openapi";

const policy = {
  maximumBytes: MAX_OPENAPI_DOCUMENT_BYTES,
  tooLarge: "OpenAPI files are limited to 1 MiB.",
  readFailure: "The OpenAPI file could not be read. The current draft is retained.",
  invalidEncoding: "The OpenAPI file must contain UTF-8 text. The current draft is retained.",
};

export function useOpenApiFileImport(props: {
  workspaceId: string | null;
  generation: number;
  enabled: boolean;
  onLoaded(source: string): void;
}) {
  return useBoundedTextFileImport({ ...props, policy });
}
