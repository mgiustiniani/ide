import type { JavaEditorDocument, JavaEditorTextEdit } from "./java-editor-transaction";
import type { JavaProjectContextAuthority } from "./java-project-context";

export interface JavaLspRefactoringCapabilities {
  available: boolean;
  serverVersion: string | null;
  changeVisibility: boolean;
  extractParameter: boolean;
  extractSuperclass: boolean;
  detail: string | null;
}

interface JavaLspRefactoringRequestBase extends JavaProjectContextAuthority {
  /** Active synchronized project root, relative to the IDE workspace root. */
  projectPath: string;
  sdkHome: string;
  file: string;
  documents: JavaEditorDocument[];
}

export type JavaLspRefactoringPreviewRequest =
  | (JavaLspRefactoringRequestBase & {
      operation: "changeVisibility";
      position: { line: number; character: number };
      visibility: "public";
    })
  | (JavaLspRefactoringRequestBase & {
      operation: "extractParameter";
      range: {
        start: { line: number; character: number };
        end: { line: number; character: number };
      };
      name: string;
    })
  | (JavaLspRefactoringRequestBase & {
      operation: "extractSuperclass";
      position: { line: number; character: number };
      superclassName: string;
      methodName: string;
    });

export type JavaLspRefactoringDocumentChange =
  | { kind: "edit"; path: string; version: number; edits: JavaEditorTextEdit[] }
  | { kind: "create"; path: string; text: string };

export interface JavaLspRefactoringPreview {
  operation: JavaLspRefactoringPreviewRequest["operation"];
  summary: string;
  providerVersion: string;
  workspaceEdit: { documentChanges: JavaLspRefactoringDocumentChange[] };
}
