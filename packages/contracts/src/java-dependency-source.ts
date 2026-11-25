import type { JavaNavigationContext, JavaEditorOverlayAttestation } from "./java-navigation";
import type { JavaProjectOperationContext } from "./java-project-context";
import type { LanguagePosition, LanguageRange } from "./language-service";

/** The provider resolves a saved or selected immutable editor binding; no source archive path is accepted. */
export interface JavaDependencySourceRequest extends JavaNavigationContext {
  requestId: string;
  projectContext: JavaProjectOperationContext;
  document: { path: string; text: string; version: number };
  position: LanguagePosition;
  /** Complete immutable Java frame, tied to a ready provider definition selection. */
  editorOverlay?: {
    expectedOverlayHash: string;
    documents: { path: string; text: string; version: number }[];
  };
}

export interface JavaDependencySourceReadRequest extends JavaDependencySourceRequest {
  expectedAssociationHash: string;
}

export interface JavaDependencySourceDeclarationRequest extends JavaDependencySourceRequest {
  expectedAssociationHash?: string;
}

export interface JavaDependencySourceDeclaration {
  nameRange: LanguageRange;
  declarationRange: LanguageRange;
  evidence: "JDT_SOURCE_BINDING";
  bindingKey: string;
}

/** Provider-owned association between one JVM binding, its binary and its owning source file. */
export interface JavaDependencySourceAssociation {
  associationHash: string;
  resourceUri: string;
  readOnly: true;
  providerId: string;
  moduleId: string;
  sourceSetId: string;
  binaryPath: string;
  binarySha256: string;
  sourceArchivePath: string;
  sourceArchiveSha256: string;
  sourceEntry: string;
  sourceSha256: string;
  jvmIdentity: {
    kind: "TYPE" | "CALLABLE" | "FIELD";
    ownerBinaryName: string;
    memberName: string;
    descriptor: string;
  };
  provenance: { kind: string; componentId: string; sourceFile: string };
}

interface JavaDependencySourceCorrelation {
  workspaceId: string;
  generation: number;
  requestId: string;
  documentPath: string;
  documentVersion: number;
  providerVersion?: string;
}

export type JavaDependencySourceResult = JavaDependencySourceCorrelation & {
  operation: "lookup" | "read";
} & (
    | {
        status: "available";
        schemaVersion: "java-dependency-source-v1" | "java-editor-dependency-source-v1";
        snapshotHash: string;
        contextHash: string;
        sdkIdentities: { release: number; identitySha256: string; sdkHome: string }[];
        association: JavaDependencySourceAssociation;
        editorOverlay?: JavaEditorOverlayAttestation;
        /** Present only after a guarded read; UTF-8 contents are bounded to 128 KiB. */
        content?: string;
      }
    | {
        status: "unavailable" | "ambiguous" | "refused";
        reason: { code: string; message: string };
        candidates?: { binaryPath: string }[];
      }
  );

export type JavaDependencySourceDeclarationResult = JavaDependencySourceCorrelation & {
  operation: "declaration";
} & (
    | {
        status: "available";
        schemaVersion:
          "java-dependency-source-declaration-v1" | "java-editor-dependency-source-declaration-v1";
        snapshotHash: string;
        contextHash: string;
        sdkIdentities: { release: number; identitySha256: string; sdkHome: string }[];
        association: JavaDependencySourceAssociation;
        declaration: JavaDependencySourceDeclaration;
        editorOverlay?: JavaEditorOverlayAttestation;
      }
    | {
        status: "unavailable" | "ambiguous" | "refused";
        reason: { code: string; message: string };
        candidates?: { binaryPath: string }[];
      }
  );

/** A prepared immutable library definition; the application retains its provider authority. */
export interface JavaLibraryDefinition {
  requestId: string;
  resourceUri: string;
  title: string;
  content: string;
  range: LanguageRange;
  declarationRange: LanguageRange;
}
