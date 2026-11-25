export interface JavaGradleSettings {
  executable: string;
  userHome: string;
  /** Optional JDK used to run Gradle; omitted to use the selected project JDK. */
  gradleRuntimeHome?: string;
  projectProperties: Record<string, string>;
}

/** RefactorKit project settings; build evaluation needs a separate explicit request. */
export interface JavaProjectContextSettings {
  projectPath: string;
  sdkHome: string;
  mavenRepository: string;
  activeMavenProfiles: string[];
  inactiveMavenProfiles: string[];
  gradle?: JavaGradleSettings;
}

/** A provider-owned saved context selected for a Java operation. */
export interface JavaProjectOperationContext extends JavaProjectContextSettings {
  contextSchemaVersion?: JavaProjectContextSchemaVersion;
  snapshotHash: string;
  contextHash: string;
  platformIdentities: string[];
}

export interface JavaProjectContextAttestation {
  projectPath: string;
  contextHash: string;
  contextSchemaVersion: JavaProjectContextSchemaVersion;
  platformIdentities: string[];
}
export interface JavaProjectContextAuthority {
  workspaceId: string;
  generation: number;
}
export interface JavaSavedSourceRecoveryRequest extends JavaProjectContextAuthority {
  projectPath: string;
  requestId: string;
}
export interface JavaProjectLanguageSettingsRequest extends JavaProjectContextAuthority {
  projectPath: string;
  contextSchemaVersion: JavaProjectContextSchemaVersion;
  snapshotHash: string;
  contextHash: string;
}
export type JavaProjectLanguageSettingsOutcome =
  "applied" | "unchanged" | "unavailable" | "refused";
export interface JavaProjectLanguageSettingsResult extends JavaProjectLanguageSettingsRequest {
  outcome: JavaProjectLanguageSettingsOutcome;
  message: string;
}
export type JavaProjectBuildSystem = "maven" | "gradle";
export type JavaProjectContextSchemaVersion =
  | "java-project-context-v1"
  | "java-project-context-v2"
  | "java-project-context-v3"
  | "java-project-context-v4"
  | "java-project-context-v5"
  | "java-project-context-v6"
  | "java-project-context-v7";
export type JavaProjectSourceSetKind = "main" | "test" | "integration-test" | "custom";
export type JavaProjectContextAvailability =
  "complete" | "not-declared" | "partial" | "unavailable" | "ambiguous";
export type JavaMavenFailsafeAvailability = JavaProjectContextAvailability | "not-applicable";
export type JavaProjectRequiredFact =
  | "source-root-provenance"
  | "compiler-options"
  | "artifact-coordinates"
  | "annotation-processors"
  | "jpms";
export type JavaProjectDependencyScope =
  "compile" | "provided" | "runtime" | "test" | "system" | "custom";
export type JavaProjectLayout = "single-module" | "multi-module";
export type JavaGradleDsl = "groovy" | "kotlin";
export type JavaProjectFramework = "plain-java" | "spring-boot-mvc";
export type JavaProjectJavaRelease = 8 | 11 | 17 | 21 | 25 | 26 | 27;
export interface CreateJavaProjectRequest extends JavaProjectContextAuthority {
  requestId: string;
  buildSystem: JavaProjectBuildSystem;
  gradleDsl?: JavaGradleDsl;
  /** Optional framework starter; omission preserves the existing plain-Java template. */
  framework?: JavaProjectFramework;
  layout: JavaProjectLayout;
  artifactId: string;
  groupId: string;
  packageName: string;
  javaRelease: JavaProjectJavaRelease;
}
export interface CreateJavaProjectResult extends JavaProjectContextAuthority {
  requestId: string;
  projectPath: string;
}
export interface JavaProjectContextRequest
  extends JavaProjectContextAuthority, JavaProjectContextSettings {
  requestId: string;
  expectedSnapshotHash?: string;
  expectedContextHash?: string;
  /** Disambiguates provider-scoped module/source-set IDs; requires provider-qualified v3-v7 context. */
  providerId?: string;
  moduleId?: string;
  sourceSetId?: string;
  /** Selects a Maven source-set kind when its provider-scoped ID is not yet known; requires context v4-v7. */
  sourceSetKind?: JavaProjectSourceSetKind;
  sourceRelativePath?: string;
  symbol?: string;
  /** Require complete facts for the selected module/source set. Never grants mutation authority. */
  requiredFacts?: JavaProjectRequiredFact[];
  /** Request provider-qualified identities for the full Gradle composite; requires explicit Gradle evaluation and the advertised aggregate v3 method. */
  aggregateGradleCompositeContext?: true;
  /** Authorizes this request to evaluate Gradle build and initialization scripts. Never persisted. */
  evaluateGradle?: true;
}
export interface JavaProjectSdk {
  home: string;
  /** Provider-reported API profile; source-set sourceLevel owns language syntax. */
  sourceRelease: number;
  platformRelease: number;
  identitySha256: string;
  releaseMetadataSha256: string;
  signatureArchive: string;
  signatureArchiveSha256: string;
}
export interface JavaProjectProvider {
  providerId: string;
  status: string;
  strategy: string;
  buildCodeExecution: string;
  credentialsAccess: string;
  networkAccess: string;
  diagnostics: string[];
}
export interface JavaProjectClasspathEntry {
  path: string;
  providerId: string;
  moduleId: string;
  sourceSetId: string;
  dependencyScope: string | null;
  fingerprint: string | null;
  artifact?: JavaProjectResolvedArtifact | null;
}
export interface JavaProjectArtifactCoordinates {
  groupId: string;
  artifactId: string;
  version: string;
}
export interface JavaProjectResolvedArtifact {
  path: string;
  coordinates: JavaProjectArtifactCoordinates;
  extension: string;
  classifier: string | null;
  scope: JavaProjectDependencyScope | null;
  transitive: boolean;
  fingerprint: string | null;
}
export interface JavaProjectCompilerOption {
  name: string;
  value: string;
  origin: string;
  redacted: boolean;
}
export interface JavaProjectAnnotationProcessors {
  availability: JavaProjectContextAvailability;
  processorPath: string[];
  dependencies: JavaProjectResolvedArtifact[];
  processorNames: string[];
  options: Record<string, string>;
  mode: string | null;
  refusalCode: string | null;
}
export interface JavaProjectSourceRootEvidence {
  path: string;
  origin: "conventional" | "build-descriptor" | "build-plugin" | "generated";
  providerId: string;
  descriptorPath: string | null;
  profileId: string | null;
  pluginId: string | null;
  executionId: string | null;
  goal: string | null;
  phase: string | null;
  availability: JavaProjectContextAvailability;
}
export interface JavaProjectModulePathEntry {
  path: string;
  moduleNames: string[];
  fingerprint: string | null;
}
export interface JavaProjectModuleRequirement {
  moduleName: string;
  modifiers: ("static" | "transitive")[];
}
export interface JavaProjectModuleExport {
  packageName: string;
  targets: string[];
}
export interface JavaProjectModuleOpen {
  packageName: string;
  targets: string[];
}
export interface JavaProjectModuleServiceProvider {
  serviceType: string;
  implementations: string[];
}
export interface JavaProjectModuleDescriptor {
  path: string;
  moduleName: string;
  open: boolean;
  requires: JavaProjectModuleRequirement[];
  exports: JavaProjectModuleExport[];
  opens: JavaProjectModuleOpen[];
  uses: string[];
  provides: JavaProjectModuleServiceProvider[];
  /** Directives absent from the provider response; their effective value is unknown. */
  unreportedDirectives: ("opens" | "uses" | "provides")[];
  contentSha256: string;
}
export interface JavaProjectJpmsContext {
  availability: JavaProjectContextAvailability;
  modulePath: JavaProjectModulePathEntry[];
  descriptors: JavaProjectModuleDescriptor[];
  refusalCode: string | null;
}
export interface JavaMavenFailsafeConfiguredValue {
  name: string;
  value: string | null;
  origin: string;
  availability: JavaMavenFailsafeAvailability;
}
export interface JavaMavenFailsafeExecution {
  pluginId: string;
  pluginVersion: string | null;
  executionId: string | null;
  goals: string[];
  phase: string | null;
  profileId: string | null;
  selectors: JavaMavenFailsafeConfiguredValue[];
  reports: JavaMavenFailsafeConfiguredValue[];
  availability: JavaMavenFailsafeAvailability;
  refusalCode: string | null;
}
export interface JavaMavenFailsafeContext {
  availability: JavaMavenFailsafeAvailability;
  refusalCode: string | null;
  executions: JavaMavenFailsafeExecution[];
}
export type JavaMavenTestJvmAvailability = JavaProjectContextAvailability | "not-applicable";
export type JavaMavenTestJvmMode = "forked" | "in-process" | "ambiguous" | "unknown" | "mixed";
export interface JavaMavenTestJvmSetting {
  name: "forkCount" | "forkMode" | "reuseForks" | "argLine";
  value: string | null;
  origin: string;
  availability: JavaMavenTestJvmAvailability;
  redacted: boolean;
}
export interface JavaMavenTestJvmExecution {
  pluginId: string;
  pluginVersion: string | null;
  executionId: string | null;
  goals: string[];
  phase: string | null;
  mode: Exclude<JavaMavenTestJvmMode, "mixed">;
  availability: Exclude<JavaMavenTestJvmAvailability, "not-declared" | "not-applicable">;
  refusalCode: string | null;
  forkSettings: JavaMavenTestJvmSetting[];
  argLineLayers: JavaMavenTestJvmSetting[];
  effectiveArgLineTemplate: string | null;
}
export interface JavaMavenTestJvmContext {
  availability: JavaMavenTestJvmAvailability;
  mode: JavaMavenTestJvmMode;
  refusalCode: string | null;
  executions: JavaMavenTestJvmExecution[];
}
export interface JavaProjectSourceSet {
  id: string;
  kind: JavaProjectSourceSetKind;
  sourceLevel: number;
  release: number | null;
  sourceRoots: string[];
  generatedSourceRoots: string[];
  outputDirectories: string[];
  analysisSourceRoots: string[];
  compileClasspath: JavaProjectClasspathEntry[];
  runtimeClasspath: JavaProjectClasspathEntry[];
  moduleDependencies: { moduleId: string; scope: string }[];
  sourceRootEvidence?: JavaProjectSourceRootEvidence[];
  compilerOptionsAvailability?: JavaProjectContextAvailability;
  compilerOptionsRefusalCode?: string | null;
  compilerOptions?: JavaProjectCompilerOption[];
  resolvedArtifactAvailability?: JavaProjectContextAvailability;
  resolvedArtifactRefusalCode?: string | null;
  resolvedArtifacts?: JavaProjectResolvedArtifact[];
  annotationProcessors?: JavaProjectAnnotationProcessors;
  jpms?: JavaProjectJpmsContext;
  /** Present in v4/v5; v5 reports not-applicable for non-Maven providers. */
  mavenFailsafe?: JavaMavenFailsafeContext;
  /** Present in v7; reports explicit origin-bearing Maven test JVM facts only. */
  mavenTestJvm?: JavaMavenTestJvmContext;
}
export interface JavaProjectModule {
  providerId: string;
  id: string;
  name: string;
  coordinates?: JavaProjectArtifactCoordinates | null;
  /** Workspace-relative evaluated Gradle build directory; `.` denotes the workspace root. */
  buildRoot?: string;
  /** Gradle logical project path, which is independent of the module's filesystem root. */
  projectPath?: string;
  root: string;
  sourceSets: JavaProjectSourceSet[];
}
export interface JavaProjectSourceAssociation {
  path: string;
  symbol: string | null;
  /** Present in provider-qualified v3, v4, and v5 source associations. */
  providerId?: string;
  moduleId: string;
  sourceSetId: string;
  sourceRoot: string;
  generated: boolean;
  bindingKey: string | null;
  evidence: string;
}
export interface JavaEffectiveProjectContext {
  schemaVersion: JavaProjectContextSchemaVersion;
  status: "available" | "partial";
  snapshotHash: string;
  contextHash: string;
  sdk: JavaProjectSdk[];
  providers: JavaProjectProvider[];
  modules: JavaProjectModule[];
  buildEvidence: { path: string; kind: string; fingerprint: string }[];
  selectedSource: JavaProjectSourceAssociation | null;
  analysis: {
    backend: string;
    snapshotHash: string;
    platformIdentitiesByRelease: Record<string, string>;
    warningCount: number;
  } | null;
  /** v6/v7 explicitly distinguish project metadata from qualified Java source analysis. */
  semanticAnalysis?: {
    availability: "available" | "unqualified";
    refusalCode: null | "java.context.sourceAnalysisUnqualified";
  };
  refusal: null;
}
export type JavaProjectContextResult = JavaProjectContextAuthority & {
  requestId: string;
  projectPath: string;
  gradleSync?: {
    schemaVersion: "java-gradle-sync-v1";
    status: "synchronized";
    /** Provider snapshot at explicit evaluation; saved-source refresh may advance the context. */
    snapshotHash: string;
    providerId: "gradle-effective-v1";
    gradleVersion: string;
    sdkHome: string;
    /** Runtime JDK used by Gradle when the provider reports it. */
    gradleRuntimeHome?: string;
  };
} & (
    | {
        status: "available" | "partial";
        engineVersion: string;
        context: JavaEffectiveProjectContext;
      }
    | {
        status: "unavailable" | "refused";
        message: string;
        code: string;
        /** Provider reason code for a failed explicit Gradle metadata export. */
        gradleFailureCause?: string;
      }
  );
