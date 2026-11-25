import type { LanguagePosition, LanguageRange } from "./language-service";
import type {
  JavaProjectOperationContext,
  JavaProjectContextAttestation,
} from "./java-project-context";

/** RefactorKit owns Java binding resolution from saved sources or immutable editor buffers; the IDE supplies an exact editor position. */
export interface JavaNavigationContext {
  workspaceId: string;
  generation: number;
}

export interface JavaNavigationRequest extends JavaNavigationContext {
  projectContext?: JavaProjectOperationContext;
  /** Immutable open Java buffers; requires explicit SDK context and provider capability. */
  editorOverlay?: { documents: { path: string; text: string; version: number }[] };
  requestId: string;
  kind:
    | "definition"
    | "references"
    | "typeDefinition"
    | "typeHierarchy"
    | "callHierarchy"
    | "implementations";
  direction?: "supertypes" | "subtypes" | "both" | "incoming" | "outgoing";
  /** Position-request document version; it need not share the buffer inventory's counter. */
  document: { path: string; text: string; version: number };
  /** Zero-based UTF-16 position, as used by language-server protocols and Monaco models. */
  position: LanguagePosition;
  includeDeclaration: boolean;
  limit: number;
}

export interface JavaNavigationLocation {
  path: string;
  range: LanguageRange;
}

export interface JavaJvmMethodIdentity {
  kind: "type" | "callable" | "field";
  ownerBinaryName: string;
  memberName: string;
  descriptor: string;
}

/** Compiler identity for one exact Java method, including overloaded classpath members. */
export interface JavaMethodBindingIdentity {
  schemaVersion: "java-method-binding-identity-v1";
  name: string;
  qualifiedName: string;
  bindingKey: string;
  jvmIdentity: JavaJvmMethodIdentity | null;
}

export type JavaCallHierarchySourceNavigation =
  | { status: "available"; location: JavaNavigationLocation }
  | {
      status: "unavailable";
      reason: "classpathSourceUnavailable";
      location: null;
    };

export interface JavaNavigationSymbolItem {
  label: string;
  relation?: "supertype" | "subtype" | "concreteType" | "concreteMethod";
  location: JavaNavigationLocation;
  callSites?: never;
  methodIdentity?: never;
  sourceNavigation?: never;
}

export interface JavaCallHierarchyItem {
  label: string;
  /** Missing only when a resolved classpath target has no workspace source location. */
  location?: JavaNavigationLocation;
  callSites: JavaNavigationLocation[];
  relation?: never;
  methodIdentity?: JavaMethodBindingIdentity;
  sourceNavigation?: JavaCallHierarchySourceNavigation;
}

export type JavaNavigationItem = JavaNavigationSymbolItem | JavaCallHierarchyItem;

/** Provider attestation of one immutable Java editor document inventory. */
export interface JavaEditorOverlayAttestation {
  baseSnapshotHash: string;
  providerSnapshotHash: string;
  overlayHash: string;
  documents: { path: string; version: number; contentSha256: string }[];
}

interface JavaNavigationCorrelation {
  workspaceId: string;
  generation: number;
  requestId: string;
  kind: JavaNavigationRequest["kind"];
  documentPath: string;
  documentVersion: number;
}

export type JavaNavigationResult = JavaNavigationCorrelation &
  (
    | {
        status: "ready";
        locations: JavaNavigationLocation[];
        /** Read-only source for Monaco previews, including attested immutable editor text. */
        sourceFiles: { path: string; text: string }[];
        items: JavaNavigationItem[];
        returned: number;
        direction?: JavaNavigationRequest["direction"];
        rootName?: string;
        targetKind?: "type" | "method";
        scope?: "workspace-source" | "workspace-direct-invocations";
        /** Target inventory reported by the RefactorKit call-hierarchy provider. */
        targetScope?: "workspace-source+resolved-classpath";
        total: number;
        truncated: boolean;
        complete: boolean;
        warningCount: number;
        snapshotHash: string;
        projectContext?: JavaProjectContextAttestation;
        indexGeneration: number;
        sourceHash: string;
        editorOverlay?: JavaEditorOverlayAttestation;
        provider: {
          name: "RefactorKit";
          version: string;
          backend: "eclipse-jdt-3.44-bindings-v1";
          evidence: "compiler";
        };
      }
    | {
        status: "unavailable" | "refused";
        message: string;
        /** Stable provider reason when one is available, such as an unqualified source context. */
        refusalCode?: string;
        /** Present only when the native bridge discarded the selected SDK session. */
        projectContextRetired?: true;
      }
  );

export function javaNavigationRefusal(
  request: JavaNavigationRequest,
  status: "unavailable" | "refused",
  message: string,
): JavaNavigationResult {
  return {
    workspaceId: request.workspaceId,
    generation: request.generation,
    requestId: request.requestId,
    kind: request.kind,
    documentPath: request.document.path,
    documentVersion: request.document.version,
    status,
    message,
  };
}
