import type {
  CreateJavaProjectRequest,
  CreateJavaProjectResult,
} from "@ide/contracts";

/** Creates project files only; RefactorKit remains responsible for project discovery. */
export interface JavaProjectScaffoldPort {
  createProject(request: CreateJavaProjectRequest): Promise<CreateJavaProjectResult>;
}
