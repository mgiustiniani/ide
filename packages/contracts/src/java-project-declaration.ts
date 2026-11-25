import type { JavaProjectContextAuthority } from "./java-project-context";
export interface JavaProjectDeclarationTestSourceSet {
  id: string;
  sourceRoots: string[];
  generatedSourceRoots?: string[];
  compileClasspath: string[];
  runtimeClasspath: string[];
  outputDirectory: string;
}
export interface JavaProjectDeclarationConfiguration {
  release: number;
  sourceRoots: string[];
  generatedSourceRoots?: string[];
  compileClasspath: string[];
  runtimeClasspath: string[];
  outputDirectory: string;
  testSourceSet?: JavaProjectDeclarationTestSourceSet;
}
export interface JavaProjectDeclarationAdditionalModule extends JavaProjectDeclarationConfiguration {
  id: string;
  root: string;
}
/** Explicit user configuration; RefactorKit owns validation and the resulting project model. */
export interface CreateJavaProjectDeclarationRequest
  extends JavaProjectContextAuthority, JavaProjectDeclarationConfiguration {
  requestId: string;
  projectPath: string;
  sdkHome: string;
  additionalModules?: JavaProjectDeclarationAdditionalModule[];
}
export interface CreateJavaProjectDeclarationResult extends JavaProjectContextAuthority {
  requestId: string;
  path: string;
}
