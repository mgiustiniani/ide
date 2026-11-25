import type { LanguageRange } from "./language-service";
import type {
  JavaProjectContextAttestation,
  JavaProjectOperationContext,
} from "./java-project-context";
import type { JavaEditorOverlayAttestation, JavaNavigationContext } from "./java-navigation";

/** Project compiler errors using captured Java buffers and a saved snapshot under an explicit SDK context. */
export interface JavaEditorDiagnosticsRequest extends JavaNavigationContext {
  requestId: string;
  projectContext: JavaProjectOperationContext & {
    contextSchemaVersion: NonNullable<JavaProjectOperationContext["contextSchemaVersion"]>;
  };
  document: { path: string; text: string; version: number };
  editorOverlay: { documents: { path: string; text: string; version: number }[] };
  limit: number;
}

interface Correlation extends JavaNavigationContext {
  requestId: string;
  kind: "diagnostics";
  documentPath: string;
  documentVersion: number;
}

export type JavaCompilerDiagnosticsProviderId =
  | "java-jdt-bindings-v1"
  | "java-sdk-compiler-diagnostics-v1"
  | "java-sdk-and-jdt-compiler-diagnostics-v1";

export type JavaEditorDiagnosticsResult = Correlation &
  (
    | {
        status: "ready";
        /** Warnings and inspections are outside this compiler-error query. */
        coverage: "compiler-errors";
        complete: true;
        /** All Java sources analyzed, including saved sources without an open buffer. */
        analyzedSourceCount: number;
        /** Source text used to validate diagnostic ranges; not a project-file inventory. */
        sourceFiles: { path: string; text: string; contentSha256: string }[];
        total: number;
        items: {
          severity: "error";
          code: string;
          message: string;
          location: { path: string; range: LanguageRange };
        }[];
        snapshotHash: string;
        indexGeneration: number;
        provider: {
          name: "RefactorKit";
          version: string;
          /** Legacy native projections may omit the JDT identity. SDK identities are explicit. */
          id?: JavaCompilerDiagnosticsProviderId;
          backend: string;
          evidence: "compiler";
        };
        projectContext: JavaProjectContextAttestation;
        editorOverlay: JavaEditorOverlayAttestation;
      }
    | {
        status: "unavailable" | "refused";
        message: string;
        refusalCode?: string;
        projectContextRetired?: true;
      }
  );
