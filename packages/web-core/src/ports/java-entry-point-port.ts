import type {
  JavaEntryPointRequest,
  JavaEntryPointResult,
  JavaProjectContextAuthority,
} from "@ide/contracts";

/** Read-only discovery through the selected RefactorKit project session. */
export interface JavaEntryPointPort {
  query(request: JavaEntryPointRequest): Promise<JavaEntryPointResult>;
  cancel(authority: JavaProjectContextAuthority, requestId: string): Promise<void>;
}
