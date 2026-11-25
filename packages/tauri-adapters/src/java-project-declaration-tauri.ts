import type {
  CreateJavaProjectDeclarationRequest,
  CreateJavaProjectDeclarationResult,
} from "@ide/contracts";
import type { JavaProjectDeclarationPort } from "@ide/web-core/ports";
import { invokeTauri } from "./errors";
export class TauriJavaProjectDeclarationAdapter implements JavaProjectDeclarationPort {
  async create(
    request: CreateJavaProjectDeclarationRequest,
  ): Promise<CreateJavaProjectDeclarationResult> {
    const result = await invokeTauri<CreateJavaProjectDeclarationResult>(
      "create_java_project_declaration",
      { request },
    );
    const path =
      (request.projectPath ? request.projectPath + "/" : "") + ".refactorkit/java-project.json";
    if (
      !result ||
      result.workspaceId !== request.workspaceId ||
      result.generation !== request.generation ||
      result.requestId !== request.requestId ||
      result.path !== path
    )
      throw new Error(
        "The Java project declaration response belongs to a different workspace or target.",
      );
    return result;
  }
}
