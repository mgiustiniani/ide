import type {
  JavaDebugCommandRequest,
  JavaDebuggerActionRequest,
  JavaDebuggerSourceRequest,
  JavaSourceBreakpointRequest,
  JavaRunToCursorRequest,
  JavaExecutionCapabilityRequest,
  JavaExecutionRequest,
  JavaExecutionSessionRequest,
  JavaTestRerunRequest,
} from "@ide/contracts";
import type { JavaExecutionPort } from "@ide/web-core/ports";

const REASON = "Java execution requires the native desktop runtime and installed Java tools.";
export class BrowserJavaExecutionAdapter implements JavaExecutionPort {
  async getCapabilities(context: JavaExecutionCapabilityRequest) {
    return {
      ...context,
      available: false,
      projectKind: "jdk" as const,
      jdk: false,
      maven: false,
      gradle: false,
      debugger: false,
      structuredDebugger: false,
      reason: REASON,
    };
  }
  async start(_request: JavaExecutionRequest): Promise<never> {
    throw new Error(REASON);
  }
  async snapshot(_request: JavaExecutionSessionRequest): Promise<never> {
    throw new Error(REASON);
  }
  async stop(_request: JavaExecutionSessionRequest): Promise<never> {
    throw new Error(REASON);
  }
  async rerunFailed(_request: JavaTestRerunRequest): Promise<never> {
    throw new Error(REASON);
  }
  async debugCommand(_request: JavaDebugCommandRequest): Promise<never> {
    throw new Error(REASON);
  }
  async debugAction(_request: JavaDebuggerActionRequest): Promise<never> {
    throw new Error(REASON);
  }
  async debugSource(_request: JavaDebuggerSourceRequest): Promise<never> {
    throw new Error(REASON);
  }
  async toggleSourceBreakpoint(_request: JavaSourceBreakpointRequest): Promise<never> {
    throw new Error(REASON);
  }
  async runToCursor(_request: JavaRunToCursorRequest): Promise<never> {
    throw new Error(REASON);
  }
}
