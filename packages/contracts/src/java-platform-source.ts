import type {
  JavaDependencySourceRequest,
  JavaDependencySourceDeclaration,
  JavaDependencySourceAssociation,
} from "./java-dependency-source";
import type { JavaEditorOverlayAttestation } from "./java-navigation";

/** The identity belongs to the selected source set's effective platform in RefactorKit's context. */
export interface JavaPlatformSourceRequest extends JavaDependencySourceRequest {
  expectedPlatformIdentitySha256: string;
}

export interface JavaPlatformSourceReadRequest extends JavaPlatformSourceRequest {
  expectedAssociationHash: string;
}

export interface JavaPlatformSourceDeclarationRequest extends JavaPlatformSourceRequest {
  expectedAssociationHash?: string;
}

/** Provider evidence for an actual JRT class and its source in the selected SDK. */
export interface JavaPlatformSourceAssociation {
  associationHash: string;
  resourceUri: string;
  readOnly: true;
  resourceKind: "java-platform-source";
  providerId: string;
  moduleId: string;
  sourceSetId: string;
  sdkHome: string;
  effectiveRelease: number;
  platformRelease: number;
  platformIdentitySha256: string;
  platformModule: string;
  binaryOrigin: {
    kind: "CURRENT_JRT_IMAGE";
    uri: string;
    classEntry: string;
    classSha256: string;
    moduleImagePath: string;
    moduleImageSha256: string;
  };
  sourceArchivePath: string;
  sourceArchiveSha256: string;
  sourceEntry: string;
  sourceSha256: string;
  sourceFile: string;
  jvmIdentity: JavaDependencySourceAssociation["jvmIdentity"];
}

interface JavaPlatformSourceCorrelation {
  workspaceId: string;
  generation: number;
  requestId: string;
  documentPath: string;
  documentVersion: number;
  providerVersion?: string;
}

interface JavaPlatformSourceProof {
  snapshotHash: string;
  contextHash: string;
  sdkIdentities: { release: number; identitySha256: string; sdkHome: string }[];
  association: JavaPlatformSourceAssociation;
  editorOverlay?: JavaEditorOverlayAttestation;
}

interface JavaPlatformSourceUnavailable {
  status: "unavailable" | "ambiguous" | "refused";
  reason: { code: string; message: string };
}

export type JavaPlatformSourceResult = JavaPlatformSourceCorrelation & {
  operation: "lookup" | "read";
} & (
    | (JavaPlatformSourceProof & {
        status: "available";
        schemaVersion: "java-platform-source-v1";
        /** Present only after a guarded read; bounded to 512 KiB of UTF-8 source. */
        content?: string;
      })
    | JavaPlatformSourceUnavailable
  );

export type JavaPlatformSourceDeclarationResult = JavaPlatformSourceCorrelation & {
  operation: "declaration";
} & (
    | (JavaPlatformSourceProof & {
        status: "available";
        schemaVersion: "java-platform-source-declaration-v1";
        declaration: JavaDependencySourceDeclaration;
      })
    | JavaPlatformSourceUnavailable
  );
