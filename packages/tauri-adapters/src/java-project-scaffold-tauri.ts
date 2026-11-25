import type { CreateJavaProjectRequest, CreateJavaProjectResult } from "@ide/contracts";
import type { JavaProjectScaffoldPort } from "@ide/web-core";
import { isNormalizedWorkspaceRelativePath } from "@ide/web-core/editor-open-coordinator";
import { invokeTauri } from "./errors";

const COMMAND = "create_java_project";

function result(
  value: unknown,
  request: CreateJavaProjectRequest,
): CreateJavaProjectResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid Java project creation result.");
  }
  const data = value as Record<string, unknown>;
  if (
    data.workspaceId !== request.workspaceId ||
    data.generation !== request.generation ||
    data.requestId !== request.requestId ||
    typeof data.projectPath !== "string" ||
    !data.projectPath ||
    data.projectPath.length > 4096 ||
    data.projectPath.includes(":") ||
    data.projectPath.includes("\0") ||
    !isNormalizedWorkspaceRelativePath(data.projectPath)
  ) {
    throw new Error("Uncorrelated Java project creation result.");
  }
  return {
    workspaceId: request.workspaceId,
    generation: request.generation,
    requestId: request.requestId,
    projectPath: data.projectPath,
  };
}

export class TauriJavaProjectScaffoldAdapter implements JavaProjectScaffoldPort {
  async createProject(request: CreateJavaProjectRequest): Promise<CreateJavaProjectResult> {
    return result(await invokeTauri(COMMAND, { request }), request);
  }
}
