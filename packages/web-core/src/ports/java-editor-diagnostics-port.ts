import type { JavaEditorDiagnosticsRequest, JavaEditorDiagnosticsResult } from "@ide/contracts";

export interface JavaEditorDiagnosticsPort {
  query(request: JavaEditorDiagnosticsRequest): Promise<JavaEditorDiagnosticsResult>;
  cancel(requestId: string): Promise<void>;
}
