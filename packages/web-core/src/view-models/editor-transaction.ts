import type { JavaEditorDocument, JavaEditorWorkspaceEdit } from "@ide/contracts";
import { isNormalizedWorkspaceRelativePath } from "../editor-open-coordinator";

function offset(text: string, point: { line: number; character: number }): number {
  if (
    !Number.isSafeInteger(point.line) ||
    point.line < 0 ||
    !Number.isSafeInteger(point.character) ||
    point.character < 0
  )
    throw new Error("Invalid editor edit position.");
  const lines = text.split("\n"),
    line = lines[point.line]?.replace(/\r$/, "");
  if (
    line === undefined ||
    point.character > line.length ||
    (point.character > 0 &&
      /[\uD800-\uDBFF]/.test(line[point.character - 1]) &&
      /[\uDC00-\uDFFF]/.test(line[point.character] ?? ""))
  )
    throw new Error("The edit range does not match the captured UTF-16 text.");
  return lines.slice(0, point.line).reduce((n, line) => n + line.length + 1, 0) + point.character;
}

/** Stage provider-owned LSP edits without mutating buffers or saved sources. */
export function stageEditorTransaction(
  documents: readonly (JavaEditorDocument & { isDirty: boolean })[],
  edit: JavaEditorWorkspaceEdit,
  restoredBuffers: readonly { path: string; text: string; isDirty: boolean }[] = [],
) {
  type StagedDocument = JavaEditorDocument & {
    isDirty: boolean;
    oldPath: string;
    before: string;
    beforeDirty: boolean;
    created?: true;
  };
  const all = new Map<string, StagedDocument>(
    documents.map((d) => [
      d.path,
      { ...d, oldPath: d.path, before: d.text, beforeDirty: d.isDirty },
    ]),
  );
  if (
    all.size !== documents.length ||
    documents.some(
      (d) =>
        !isNormalizedWorkspaceRelativePath(d.path) ||
        !Number.isSafeInteger(d.version) ||
        d.version < 1 ||
        d.version > 2147483647,
    ) ||
    !edit ||
    !Array.isArray(edit.documentChanges) ||
    edit.documentChanges.length > 1024
  )
    throw new Error("Invalid captured editor transaction.");
  const edited = new Set<string>();
  for (const change of edit.documentChanges) {
    if (change.kind === "create") {
      if (
        !isNormalizedWorkspaceRelativePath(change.path) ||
        !change.path.toLowerCase().endsWith(".java") ||
        all.has(change.path) ||
        typeof change.text !== "string" ||
        new TextEncoder().encode(change.text).length > 1024 * 1024
      )
        throw new Error("The proposed Java file is invalid or already open.");
      all.set(change.path, {
        path: change.path,
        text: change.text,
        version: 1,
        isDirty: true,
        oldPath: change.path,
        before: "",
        beforeDirty: false,
        created: true,
      });
      continue;
    }
    const path = change.kind === "rename" ? change.oldPath : change.path,
      current = all.get(path);
    if (!current) throw new Error("Open every affected document before applying its edits.");
    if (change.kind === "rename") {
      if (!isNormalizedWorkspaceRelativePath(change.path) || all.has(change.path))
        throw new Error("Editor rename destination already exists or is invalid.");
      all.delete(path);
      all.set(change.path, { ...current, path: change.path, version: 1 });
    } else {
      if (
        edited.has(current.oldPath) ||
        current.version !== change.version ||
        !Array.isArray(change.edits) ||
        change.edits.length > 4096
      )
        throw new Error("The proposed edit uses an obsolete document version.");
      edited.add(current.oldPath);
      const ranges = change.edits
        .map((e) => ({
          start: offset(current.text, e.range.start),
          end: offset(current.text, e.range.end),
          text: e.newText,
        }))
        .sort((a, b) => a.start - b.start || a.end - b.end);
      if (
        ranges.some(
          (r, i) =>
            r.start > r.end ||
            typeof r.text !== "string" ||
            (i > 0 &&
              (ranges[i - 1].end > r.start ||
                (ranges[i - 1].start === r.start && ranges[i - 1].end === r.end))),
        )
      )
        throw new Error("Invalid or overlapping editor edits.");
      let text = current.text;
      for (const r of ranges.slice().reverse())
        text = text.slice(0, r.start) + r.text + text.slice(r.end);
      if (new TextEncoder().encode(text).length > 1024 * 1024)
        throw new Error("The transformed buffer exceeds the editor transaction limit.");
      if (current.version === 2147483647)
        throw new Error("Reopen the document before advancing its version.");
      all.set(path, {
        ...current,
        text,
        version: current.version + 1,
        isDirty: current.isDirty || text !== current.text,
      });
    }
  }
  const results = [...all.values()];
  for (const document of results) {
    const original = restoredBuffers.find((d) => d.path === document.path);
    if (original && original.text === document.text) document.isDirty = original.isDirty;
  }
  return Object.freeze({
    documents: Object.freeze(
      results.map(({ path, text, version }) => Object.freeze({ path, text, version })),
    ),
    changes: Object.freeze(
      results
        .filter((d) => d.oldPath !== d.path || d.before !== d.text || d.beforeDirty !== d.isDirty)
        .map((d) =>
          Object.freeze({
            oldPath: d.oldPath,
            path: d.path,
            before: d.before,
            after: d.text,
            isDirty: d.isDirty,
            ...(d.created ? { created: true as const } : {}),
          }),
        ),
    ),
    versions: Object.freeze(
      results
        .filter((d) => d.created || d.oldPath !== d.path || edited.has(d.oldPath))
        .map(({ oldPath, path, version }) => Object.freeze({ oldPath, path, version })),
    ),
  });
}
