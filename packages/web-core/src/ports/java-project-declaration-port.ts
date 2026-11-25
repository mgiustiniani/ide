import type {
  CreateJavaProjectDeclarationRequest,
  CreateJavaProjectDeclarationResult,
} from "@ide/contracts";
export interface JavaProjectDeclarationPort {
  create(request: CreateJavaProjectDeclarationRequest): Promise<CreateJavaProjectDeclarationResult>;
}
