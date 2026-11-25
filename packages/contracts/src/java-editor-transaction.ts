import type {
  JavaProjectOperationContext,
  JavaProjectContextAuthority,
} from "./java-project-context";
import type { JavaFormatterProfile } from "./editor";

export interface JavaEditorDocument {
  path: string;
  text: string;
  version: number;
}
export interface JavaEditorTextEdit {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  newText: string;
}
/** LSP document changes with native-validated workspace paths instead of file URIs. */
export type JavaEditorDocumentChange =
  | { kind: "edit"; path: string; version: number; edits: JavaEditorTextEdit[] }
  | { kind: "rename"; oldPath: string; path: string }
  /** Client-managed LSP CreateFile proposal; the editor keeps it unsaved until the user saves. */
  | { kind: "create"; path: string; text: string };
export interface JavaEditorWorkspaceEdit {
  documentChanges: JavaEditorDocumentChange[];
}
export interface JavaEditorTransactionRequest extends JavaProjectContextAuthority {
  phase:
    | "prepare"
    | "confirm"
    | "undo.prepare"
    | "undo.confirm"
    | "recover"
    | "transactions"
    | "apply-files";
  projectContext: JavaProjectOperationContext;
  /** Used only when preparing or confirming a reviewed format-file plan. */
  formatterProfile?: JavaFormatterProfile;
  formatterProfileSha256?: string;
  planId?: string;
  approvedPlanHash?: string;
  transactionId?: string;
  documents: JavaEditorDocument[];
}
export interface JavaEditorTransaction {
  transactionId: string;
  planId: string;
  approvedPlanHash: string;
  baseSnapshotHash: string;
  contextHash: string;
  sdkHome?: string;
  status: "prepared" | "applied" | "undo-prepared" | "undone" | "aborted" | "recovery-required";
  durableRecoveryAvailable: true;
  platformIdentities?: string[];
  workspaceEdit?: JavaEditorWorkspaceEdit;
  sourceAuthority?: {
    baseSnapshotHash: string;
    documents: { path: string; version: number; contentSha256: string }[];
    overlayHash: string;
  };
  refusalCode?: string;
  revalidationRequired?: boolean;
  /** Approved document lineage; finalPath does not assert the current physical file location. */
  documents?: { originalPath: string; finalPath: string; originalSavedContentSha256: string }[];
}
export type JavaEditorTransactionResult =
  | { kind: "transaction"; transaction: JavaEditorTransaction }
  | { kind: "discovery"; transactions: JavaEditorTransaction[] }
  | {
      kind: "files-applied";
      transactionId: string;
      diskSources: { oldPath: string; path: string; revision: string }[];
    };
