import { useRef, useState } from "react";
import { JavaCleanupFileSearch, type JavaCleanupFileSearchPort } from "./JavaCleanupFileSearch";
import type { JavaCleanupAction, RefactorKitChangeIntent, RefactoringTarget } from "@ide/contracts";

/** Explicit saved-file selection. RefactorKit owns cleanup analysis and edits. */
export function JavaBatchCleanupFields({ target, intent, disabled, onChange, onTarget, searchFiles, workspaceGeneration = 0, projectPath = "" }: {
  searchFiles?: JavaCleanupFileSearchPort;
  workspaceGeneration?: number;
  projectPath?: string;
  target: RefactoringTarget;
  intent: RefactorKitChangeIntent | undefined;
  disabled: boolean;
  onChange(intent: RefactorKitChangeIntent): void;
  onTarget(target: RefactoringTarget): void;
}) {
  const [searchRow, setSearchRow] = useState<{ index: number; generation: number; project: string }>();
  const browseButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const closeSearch = () => {
    if (searchRow) browseButtons.current[searchRow.index]?.focus();
    setSearchRow(undefined);
  };
  const actions: JavaCleanupAction[] = intent?.operation === "batch-cleanup" ? intent.actions : [
    { operation: "organize-imports", path: target.path },
    { operation: "organize-imports", path: "" },
  ];
  const change = (next: JavaCleanupAction[]) => {
    setSearchRow(undefined);
    if (next[0].path !== target.path)
      onTarget({ kind: "file", path: next[0].path, identity: next[0].path });
    onChange({ operation: "batch-cleanup", actions: next });
  };
  return (
    <fieldset disabled={disabled} className="col-span-2 space-y-2" aria-label="Java cleanup files">
      <legend className="font-medium">Java cleanup files</legend>
      <p className="text-xs text-[var(--text-secondary)]">Select 2–16 distinct saved Java files in the synchronized project. Each file has one cleanup action. Review the entire batch before Apply; any refused action refuses the batch.</p>
      {actions.map((action, index) => (
        <div key={index} className="flex gap-2">
          <input disabled={disabled} aria-label={`Cleanup file ${index + 1}`} value={action.path} placeholder="Workspace-relative Java source path"
            className="min-w-0 flex-1 rounded border border-[var(--border-default)] bg-[var(--surface-background)] px-2 py-1 text-[var(--text-primary)] disabled:text-[var(--text-muted)]"
            onChange={(event) => change(actions.map((item, row) => row === index ? { ...item, path: event.target.value } : item))} />
          {searchFiles ? <button type="button" disabled={disabled} aria-label={`Find cleanup file ${index + 1}`}
            ref={(button) => { browseButtons.current[index] = button; }}
            onClick={() => setSearchRow({ index, generation: workspaceGeneration, project: projectPath })}>Find file</button> : null}
          <select disabled={disabled} aria-label={`Cleanup action ${index + 1}`} value={action.operation}
            className="rounded border border-[var(--border-default)] bg-[var(--surface-background)] px-2 py-1 text-[var(--text-primary)] disabled:text-[var(--text-muted)]"
            onChange={(event) => change(actions.map((item, row) => row === index ? { ...item, operation: event.target.value as JavaCleanupAction["operation"] } : item))}>
            <option value="organize-imports">Organize imports</option>
            <option value="format-file">Format file</option>
          </select>
          <button type="button" disabled={disabled || actions.length <= 2} aria-label={`Remove cleanup file ${index + 1}`}
            onClick={() => change(actions.filter((_, row) => row !== index))}>Remove</button>
        </div>
      ))}
      {!disabled && searchFiles && searchRow && searchRow.generation === workspaceGeneration && searchRow.project === projectPath ? (
        <JavaCleanupFileSearch key={`${workspaceGeneration}:${projectPath}:${searchRow.index}`} search={searchFiles}
          generation={workspaceGeneration} projectPath={projectPath}
          selectedPaths={actions.filter((_, row) => row !== searchRow.index).map((action) => action.path)}
          onClose={closeSearch} onSelect={(path) => {
            change(actions.map((action, row) => row === searchRow.index ? { ...action, path } : action));
            closeSearch();
          }} />
      ) : null}
      <button type="button" disabled={disabled || actions.length >= 16} onClick={() => change([...actions, { operation: "organize-imports", path: "" }])}>Add cleanup file</button>
    </fieldset>
  );
}
