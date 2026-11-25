import type { EditorDiskStatus } from "@ide/contracts";

export function EditorBackgroundDiskChanges({ issues, activeFilePath, onSelect }: {
  issues: readonly EditorDiskStatus[];
  activeFilePath: string | null;
  onSelect(filePath: string): void;
}) {
  const background = issues.filter((issue) => issue.filePath !== activeFilePath);
  if (!background.length) return null;
  return (
    <div role="status" aria-label="Other open files changed on disk" className="px-3 py-2 text-sm">
      <p>Other open files need disk review. Your buffers are retained.</p>
      <ul>
        {background.map((issue) => (
          <li key={issue.filePath}>
            <button type="button" className="underline" onClick={() => onSelect(issue.filePath)}>
              {issue.filePath}
            </button>
            {" — "}{issue.status === "changed" ? "changed on disk"
              : issue.status === "missing" ? "missing on disk" : "disk check unavailable"}
          </li>
        ))}
      </ul>
    </div>
  );
}
