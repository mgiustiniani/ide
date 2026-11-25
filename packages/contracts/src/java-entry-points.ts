import type { LanguagePosition, LanguageRange } from "./language-service";
import type {
  JavaProjectContextAuthority,
  JavaProjectOperationContext,
} from "./java-project-context";

/** The exact provider-owned scope; IDs are not inferred from source paths. */
export interface JavaEntryPointScope {
  providerId: string;
  moduleId: string;
  sourceSetId: string;
}

export interface JavaEntryPointRequest extends JavaProjectContextAuthority {
  requestId: string;
  projectContext: JavaProjectOperationContext;
  scope: JavaEntryPointScope;
  /** Optional workspace-relative saved source. Discovery does not save editor buffers. */
  path?: string;
  /** Zero-based UTF-16 cursor; valid only with an exact source path. */
  position?: LanguagePosition;
  limit: number;
  /** Explicit protocol opt-in; omission retains classic v1 behavior. */
  entryPointSchemaVersion?: "java-entry-points-v2";
  launchProfile?: "classic-declared-v1" | "inherited-v1" | "java25-v1";
}

/** A provider-qualified classic main, including secondary and nested binary classes. */
export interface JavaClassicEntryPoint {
  entryPointId: string;
  binaryName: string;
  declaringBinaryName: string;
  descriptor: "([Ljava/lang/String;)V";
  invocation: "static";
  inherited: false;
  generated: boolean;
  sourceLevel: number;
  targetLevel: number;
  source: { path: string; range: LanguageRange };
}

export interface JavaEntryPointDiscoveryV1 {
  schemaVersion: "java-entry-points-v1";
  requestId: string;
  kind: "entryPoints";
  status: "ready";
  snapshotHash: string;
  indexGeneration: number;
  contextHash: string;
  contextSchemaVersion: string;
  providerId: "java-jdt-bindings-v1";
  backend: "eclipse-jdt-3.44-bindings-v1";
  evidence: "compiler";
  provenanceHash: string;
  scope: JavaEntryPointScope;
  platformIdentities: string[];
  launcherRelease: number;
  launchProfile: "classic-declared-v1";
  scopeAnalysisComplete: boolean;
  /** False until every required launch form is qualified; never infer zero mains from a partial list. */
  complete: boolean;
  coverage: { qualifiedProfiles: string[]; unqualifiedProfiles: string[] };
  selection?: {
    mode: "enclosing-type";
    path: string;
    position: LanguagePosition;
    binaryName: string;
    range: LanguageRange;
  };
  candidates: JavaClassicEntryPoint[];
  returnedCount: number;
  totalEligibleCount: number | null;
  observedEligibleLowerBound: number;
  truncated: boolean;
}

export type JavaEntryPointDeclaration =
  | { kind: "source"; path: string; range: LanguageRange }
  | {
      kind: "binary";
      originKind: "classpath" | "platform";
      uri: string;
      moduleName?: string;
      inputPath: string;
      inputSha256: string;
    };
export type JavaModernEntryPoint = Omit<
  JavaClassicEntryPoint,
  "descriptor" | "invocation" | "inherited" | "source"
> & {
  descriptor: "()V" | "([Ljava/lang/String;)V";
  inherited: boolean;
  source: { path: string; range: LanguageRange; form: "declared" | "compact" };
  declaration: JavaEntryPointDeclaration;
} & (
    | { invocation: "static"; construction?: never }
    | { invocation: "instance"; construction: { binaryName: string; descriptor: "()V" } }
  );
export type JavaEntryPoint = JavaClassicEntryPoint | JavaModernEntryPoint;
export interface JavaEntryPointDiscoveryV2 extends Omit<
  JavaEntryPointDiscoveryV1,
  | "schemaVersion"
  | "providerId"
  | "backend"
  | "launcherRelease"
  | "launchProfile"
  | "scopeAnalysisComplete"
  | "coverage"
  | "candidates"
  | "totalEligibleCount"
> {
  schemaVersion: "java-entry-points-v2";
  providerId: "java-sdk-launcher-v2";
  backend: "jdk25-javac";
  launcherRelease: 25;
  launchProfile: "inherited-v1" | "java25-v1";
  scopeAnalysisComplete: true;
  coverage: {
    qualifiedProfiles: string[];
    unqualifiedProfiles: string[];
    qualifiedCell: {
      sourceLevel: 25;
      targetLevel: 25;
      platformRelease: 25;
      launcherRelease: 25;
      preview: false;
    };
  };
  launcher: {
    sdkHome: string;
    executable: string;
    executableSha256: string;
    compilerSha256: string;
    platformIdentity: string;
  };
  analysis: {
    snapshotHash: string;
    workerSha256: string;
    sourceLevel: 25;
    targetLevel: 25;
    analyzedSourceCount: number;
    classpathInputs: { path: string; sha256: string }[];
  };
  candidates: JavaModernEntryPoint[];
  totalEligibleCount: number;
  ineligibleCount: number;
  ineligibleTypesTruncated: boolean;
  ineligibleTypes: {
    binaryName: string;
    reason: "java.entryPoints.instanceCreationIneligible";
    source: { path: string; range: LanguageRange };
  }[];
}
export type JavaEntryPointDiscovery = JavaEntryPointDiscoveryV1 | JavaEntryPointDiscoveryV2;

export interface JavaEntryPointResult extends JavaProjectContextAuthority {
  requestId: string;
  status: "ready" | "unavailable" | "refused" | "cancelled";
  message: string;
  discovery?: JavaEntryPointDiscovery;
}
