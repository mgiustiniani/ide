import type {
  JavaLspRefactoringCapabilities,
  JavaLspRefactoringPreview,
  JavaLspRefactoringPreviewRequest,
  JavaProjectContextAuthority,
} from "@ide/contracts";

export interface JavaLspRefactoringPort {
  getCapabilities(
    authority: JavaProjectContextAuthority & { sdkHome: string },
  ): Promise<JavaLspRefactoringCapabilities>;
  preview(request: JavaLspRefactoringPreviewRequest): Promise<JavaLspRefactoringPreview>;
}
