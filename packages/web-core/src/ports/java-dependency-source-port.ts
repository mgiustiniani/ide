import type {
  JavaDependencySourceRequest,
  JavaDependencySourceReadRequest,
  JavaDependencySourceResult,
  JavaDependencySourceDeclarationRequest,
  JavaDependencySourceDeclarationResult,
} from "@ide/contracts";

/** Saved or immutable-editor dependency navigation; results grant no filesystem or edit authority. */
export interface JavaDependencySourcePort {
  lookup(request: JavaDependencySourceRequest): Promise<JavaDependencySourceResult>;
  read(request: JavaDependencySourceReadRequest): Promise<JavaDependencySourceResult>;
  declaration(
    request: JavaDependencySourceDeclarationRequest,
  ): Promise<JavaDependencySourceDeclarationResult>;
}
