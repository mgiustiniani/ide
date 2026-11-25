import type {
  JavaNavigationContext,
  JavaNavigationRequest,
  JavaNavigationResult,
} from "@ide/contracts";

export interface JavaNavigationPort {
  query(request: JavaNavigationRequest): Promise<JavaNavigationResult>;
  cancel(requestId: string): Promise<void>;
  stop(context: JavaNavigationContext): Promise<void>;
}
