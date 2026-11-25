import type {
  JavaPlatformSourceRequest,
  JavaPlatformSourceReadRequest,
  JavaPlatformSourceDeclarationRequest,
  JavaPlatformSourceResult,
  JavaPlatformSourceDeclarationResult,
} from "@ide/contracts";

/** Read-only SDK sources; missing archives and historical release sources remain explicit. */
export interface JavaPlatformSourcePort {
  lookup(request: JavaPlatformSourceRequest): Promise<JavaPlatformSourceResult>;
  read(request: JavaPlatformSourceReadRequest): Promise<JavaPlatformSourceResult>;
  declaration(
    request: JavaPlatformSourceDeclarationRequest,
  ): Promise<JavaPlatformSourceDeclarationResult>;
}
