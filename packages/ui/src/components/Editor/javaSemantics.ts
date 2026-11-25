import type {
  JavaCompletionItemKind,
  JavaCompletionItem,
  JavaSemanticDocumentTarget,
  JavaCompletionRequest,
  JavaCompletionResponse,
  JavaFormattingRequest,
  JavaFormattingResponse,
  JavaRangeFormattingRequest,
  JavaOnTypeFormattingRequest,
  JavaRangeFormattingResponse,
  JavaCodeActionsRequest,
  JavaCodeActionsResponse,
  JavaCodeAction,
  JavaCodeActionGenerationSelection,
  JavaCodeActionMemberSelection,
  JavaTextEdit,
  JavaRenameRequest,
  JavaRenameResponse,
  JavaDocumentSymbol,
  JavaDocumentSymbolKind,
  JavaDocumentSymbolsResponse,
  JavaDocumentHighlightsResponse,
  JavaSemanticTokensResponse,
  JavaInlayHintsRequest,
  JavaInlayHintsResponse,
  JavaHoverRequest,
  JavaHoverResponse,
  JavaSemanticContent,
  JavaSemanticResponseMetadata,
  JavaSignatureHelpRequest,
  JavaSignatureHelpResponse,
  LanguageRange,
  LanguageServiceCancellationId,
} from "@ide/contracts";
import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api";
import type { JavaEditorSemantics, JavaWorkspaceDocumentChange } from "./Editor";

const COMPLETION_KINDS: Record<JavaCompletionItemKind, Monaco.languages.CompletionItemKind> = {
  text: 0,
  method: 1,
  function: 2,
  constructor: 3,
  field: 4,
  variable: 5,
  class: 6,
  interface: 7,
  module: 8,
  property: 9,
  unit: 10,
  value: 11,
  enum: 12,
  keyword: 13,
  snippet: 14,
  color: 15,
  file: 16,
  reference: 17,
  folder: 18,
  "enum-member": 19,
  constant: 20,
  struct: 21,
  event: 22,
  operator: 23,
  "type-parameter": 24,
  unknown: 0,
};

const DOCUMENT_SYMBOL_KINDS: Record<JavaDocumentSymbolKind, Monaco.languages.SymbolKind> = {
  file: 0,
  module: 1,
  namespace: 2,
  package: 3,
  class: 4,
  method: 5,
  property: 6,
  field: 7,
  constructor: 8,
  enum: 9,
  interface: 10,
  function: 11,
  variable: 12,
  constant: 13,
  string: 14,
  number: 15,
  boolean: 16,
  array: 17,
  object: 18,
  key: 19,
  null: 20,
  "enum-member": 21,
  struct: 22,
  event: 23,
  operator: 24,
  "type-parameter": 25,
};

const SEMANTIC_TOKEN_TYPES = [
  "namespace",
  "type",
  "class",
  "enum",
  "interface",
  "struct",
  "typeParameter",
  "parameter",
  "variable",
  "property",
  "enumMember",
  "event",
  "function",
  "method",
  "macro",
  "keyword",
  "modifier",
  "comment",
  "string",
  "number",
  "regexp",
  "operator",
  "decorator",
  "annotation",
  "annotationMember",
  "record",
  "recordComponent",
];
const SEMANTIC_TOKEN_MODIFIERS = [
  "declaration",
  "definition",
  "readonly",
  "static",
  "deprecated",
  "abstract",
  "async",
  "modification",
  "documentation",
  "defaultLibrary",
  "public",
  "private",
  "protected",
  "native",
  "generic",
  "typeArgument",
  "importDeclaration",
  "constructor",
];

let requestSequence = 0;
function nextId(kind: "request" | "cancel"): string {
  requestSequence = requestSequence >= 0xffff_ffff ? 1 : requestSequence + 1;
  return `java-ui-${kind}-${Date.now().toString(36)}-${requestSequence.toString(36)}`;
}

function uriOf(model: Monaco.editor.ITextModel): string {
  return model.uri.toString();
}

function isValidPosition(
  model: Monaco.editor.ITextModel,
  line: number,
  character: number,
): boolean {
  if (!Number.isInteger(line) || !Number.isInteger(character) || line < 0 || character < 0)
    return false;
  const lineNumber = line + 1;
  return lineNumber <= model.getLineCount() && character <= model.getLineMaxColumn(lineNumber) - 1;
}

function toRange(model: Monaco.editor.ITextModel, range: LanguageRange): Monaco.IRange | undefined {
  const { start, end } = range;
  if (
    !isValidPosition(model, start.line, start.character) ||
    !isValidPosition(model, end.line, end.character)
  )
    return undefined;
  if (end.line < start.line || (end.line === start.line && end.character < start.character))
    return undefined;
  return {
    startLineNumber: start.line + 1,
    startColumn: start.character + 1,
    endLineNumber: end.line + 1,
    endColumn: end.character + 1,
  };
}

function comparePosition(
  left: { lineNumber: number; column: number },
  right: { lineNumber: number; column: number },
): number {
  return left.lineNumber - right.lineNumber || left.column - right.column;
}

function languageRangeContains(outer: LanguageRange, inner: LanguageRange): boolean {
  const compare = (left: LanguageRange["start"], right: LanguageRange["start"]) =>
    left.line - right.line || left.character - right.character;
  return compare(inner.start, outer.start) >= 0 && compare(inner.end, outer.end) <= 0;
}

function overlaps(left: Monaco.IRange, right: Monaco.IRange): boolean {
  const leftStart = { lineNumber: left.startLineNumber, column: left.startColumn };
  const leftEnd = { lineNumber: left.endLineNumber, column: left.endColumn };
  const rightStart = { lineNumber: right.startLineNumber, column: right.startColumn };
  const rightEnd = { lineNumber: right.endLineNumber, column: right.endColumn };
  const leftEmpty = comparePosition(leftStart, leftEnd) === 0;
  const rightEmpty = comparePosition(rightStart, rightEnd) === 0;
  if (leftEmpty && rightEmpty) return comparePosition(leftStart, rightStart) === 0;
  if (leftEmpty)
    return comparePosition(rightStart, leftStart) <= 0 && comparePosition(leftStart, rightEnd) <= 0;
  if (rightEmpty)
    return comparePosition(leftStart, rightStart) <= 0 && comparePosition(rightStart, leftEnd) <= 0;
  return comparePosition(leftStart, rightEnd) < 0 && comparePosition(rightStart, leftEnd) < 0;
}

function validActionGenerationSelection(
  available: JavaCodeActionMemberSelection,
  selected: JavaCodeActionGenerationSelection,
): boolean {
  const fields = available.groups.find((group) => group.id === "fields")?.members ?? [];
  const constructors = available.groups.find((group) => group.id === "constructors")?.members ?? [];
  const overridableMethods =
    available.groups.find((group) => group.id === "overridableMethods")?.members ?? [];
  const delegateMethods =
    available.groups.find((group) => group.id === "delegateMethods")?.members ?? [];
  const validKeys = (keys: string[], members: typeof fields, limit = 64) =>
    keys.length <= limit &&
    keys.every(
      (key, index) =>
        members.some((member) => member.selectionKey === key) &&
        keys.slice(0, index).every((previous) => previous !== key),
    );
  return (
    selected.kind === available.kind &&
    validKeys(selected.selectedFieldBindingKeys, fields) &&
    validKeys(selected.selectedConstructorBindingKeys, constructors) &&
    validKeys(selected.selectedOverridableMethodKeys, overridableMethods) &&
    validKeys(selected.selectedDelegateMethodKeys, delegateMethods, 128) &&
    (selected.kind === "constructors"
      ? selected.selectedConstructorBindingKeys.length > 0
      : selected.kind === "hashCodeEquals"
        ? selected.selectedFieldBindingKeys.length > 0 &&
          selected.selectedConstructorBindingKeys.length === 0 &&
          selected.selectedOverridableMethodKeys.length === 0 &&
          selected.selectedDelegateMethodKeys.length === 0
        : selected.kind === "overrideMethods"
          ? selected.selectedOverridableMethodKeys.length > 0 &&
            selected.selectedFieldBindingKeys.length === 0 &&
            selected.selectedConstructorBindingKeys.length === 0 &&
            selected.selectedDelegateMethodKeys.length === 0
          : selected.selectedDelegateMethodKeys.length > 0 &&
            selected.selectedFieldBindingKeys.length === 0 &&
            selected.selectedConstructorBindingKeys.length === 0)
  );
}

function mapCodeActionEdits(
  model: Monaco.editor.ITextModel,
  edits: JavaTextEdit[],
): Monaco.editor.IIdentifiedSingleEditOperation[] | null {
  if (edits.length === 0) return null;
  const mapped = edits.map((edit) => {
    const range = toRange(model, edit.range);
    return range ? { range, text: edit.newText } : null;
  });
  if (
    mapped.some((edit) => edit === null) ||
    mapped.some((edit, index) =>
      mapped
        .slice(0, index)
        .some((previous) => edit && previous && overlaps(edit.range, previous.range)),
    )
  )
    return null;
  return mapped as Monaco.editor.IIdentifiedSingleEditOperation[];
}

type MappedWorkspaceDocumentEdit = {
  filePath: string;
  model: Monaco.editor.ITextModel;
  version: number;
  edits: Monaco.editor.IIdentifiedSingleEditOperation[];
  before: string;
  after: string;
};

function applyMappedEditsToText(
  model: Monaco.editor.ITextModel,
  edits: Monaco.editor.IIdentifiedSingleEditOperation[],
): string | null {
  const eol = model.getEOL();
  const replacements = edits.flatMap((edit) => {
    if (typeof edit.text !== "string") return [];
    const start = model.getOffsetAt({
      lineNumber: edit.range.startLineNumber,
      column: edit.range.startColumn,
    });
    const end = model.getOffsetAt({
      lineNumber: edit.range.endLineNumber,
      column: edit.range.endColumn,
    });
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) return [];
    return [{ start, end, text: edit.text.replace(/\r\n|\r|\n/g, eol) }];
  });
  if (replacements.length !== edits.length) return null;
  let value = model.getValue();
  for (const replacement of replacements.sort((left, right) => right.start - left.start))
    value = `${value.slice(0, replacement.start)}${replacement.text}${value.slice(replacement.end)}`;
  return value;
}

function mapCodeActionWorkspaceEdits(
  candidate: Monaco.editor.ITextModel,
  action: JavaCodeAction,
  workspaceId: string,
  activeDocument: JavaSemanticDocumentTarget,
  modelsByUri: Map<string, Monaco.editor.ITextModel>,
  versionsByUri: Map<string, number>,
  currentModels: Monaco.editor.ITextModel[],
): MappedWorkspaceDocumentEdit[] | null {
  const documentEdits = new Map<
    string,
    { filePath: string; model: Monaco.editor.ITextModel; version: number; edits: JavaTextEdit[] }
  >();
  documentEdits.set(candidate.uri.toString(), {
    filePath: activeDocument.path,
    model: candidate,
    version: versionsByUri.get(candidate.uri.toString()) ?? -1,
    edits: action.edits,
  });
  for (const additional of action.additionalEdits ?? []) {
    const uri = additional.document.uri;
    const model = modelsByUri.get(uri);
    const version = versionsByUri.get(uri);
    if (
      additional.document.workspaceId !== workspaceId ||
      additional.document.path === activeDocument.path ||
      uri === activeDocument.uri ||
      !Number.isSafeInteger(additional.document.version) ||
      additional.document.version < 0 ||
      !model ||
      !currentModels.includes(model) ||
      version === undefined ||
      version !== additional.document.version ||
      model.getVersionId() !== version ||
      model.getLanguageId() !== "java"
    )
      return null;
    const group = documentEdits.get(uri) ?? {
      filePath: additional.document.path,
      model,
      version,
      edits: [],
    };
    group.edits.push(additional.edit);
    documentEdits.set(uri, group);
  }

  const edits: MappedWorkspaceDocumentEdit[] = [];
  for (const [uri, document] of documentEdits) {
    if (document.edits.length === 0) continue;
    if (
      document.version < 0 ||
      document.model.getVersionId() !== document.version ||
      !currentModels.includes(document.model)
    )
      return null;
    const mapped = mapCodeActionEdits(document.model, document.edits);
    if (!mapped) return null;
    const after = applyMappedEditsToText(document.model, mapped);
    if (after === null || after === document.model.getValue()) return null;
    edits.push({
      filePath: document.filePath,
      model: document.model,
      version: document.version,
      edits: mapped,
      before: document.model.getValue(),
      after,
    });
    if (document.model.uri.toString() !== uri) return null;
  }
  return edits.length > 0 ? edits : null;
}

function containsRange(outer: Monaco.IRange, inner: Monaco.IRange): boolean {
  return (
    comparePosition(
      { lineNumber: outer.startLineNumber, column: outer.startColumn },
      { lineNumber: inner.startLineNumber, column: inner.startColumn },
    ) <= 0 &&
    comparePosition(
      { lineNumber: inner.endLineNumber, column: inner.endColumn },
      { lineNumber: outer.endLineNumber, column: outer.endColumn },
    ) <= 0
  );
}

function mapDocumentSymbol(
  model: Monaco.editor.ITextModel,
  symbol: JavaDocumentSymbol,
): Monaco.languages.DocumentSymbol | undefined {
  const range = toRange(model, symbol.range);
  const selectionRange = toRange(model, symbol.selectionRange);
  if (!range || !selectionRange || !containsRange(range, selectionRange)) return undefined;
  const children = symbol.children?.map((child) => mapDocumentSymbol(model, child));
  if (children?.some((child) => !child || !containsRange(range, child.range))) return undefined;
  return {
    name: symbol.name,
    detail: symbol.detail ?? "",
    kind: DOCUMENT_SYMBOL_KINDS[symbol.kind],
    tags: symbol.deprecated ? [1] : [],
    range,
    selectionRange,
    ...(children?.length ? { children: children as Monaco.languages.DocumentSymbol[] } : {}),
  };
}

/** Admit only current, same-document LSP edits that Monaco can apply atomically. */
export function mapJavaCompletionAdditionalEdits(
  model: Monaco.editor.ITextModel,
  item: JavaCompletionItem,
  workspaceId: string,
  document: JavaSemanticDocumentTarget,
  primaryRange: Monaco.IRange,
): Monaco.editor.ISingleEditOperation[] | null {
  const edits = item.additionalTextEdits ?? [];
  const mapped: Monaco.editor.ISingleEditOperation[] = [];
  for (const additional of edits) {
    const { document: identity, edit } = additional;
    if (
      identity.workspaceId !== workspaceId ||
      identity.path !== document.path ||
      identity.uri !== document.uri ||
      identity.version !== document.version
    )
      return null;
    const range = toRange(model, edit.range);
    if (
      !range ||
      overlaps(primaryRange, range) ||
      mapped.some((previous) => overlaps(previous.range, range))
    )
      return null;
    mapped.push({ range, text: edit.newText });
  }
  return mapped;
}

function displayContent(content: JavaSemanticContent): Monaco.IMarkdownString {
  return content.format === "markdown"
    ? { value: content.value, isTrusted: false, supportHtml: false }
    : { value: content.value, isTrusted: false, supportHtml: false };
}

function sameContext(
  current: JavaEditorSemantics | undefined,
  expected: JavaEditorSemantics,
): boolean {
  const actual = current?.context;
  const snapshot = expected.context;
  return Boolean(
    actual &&
    snapshot &&
    actual.workspaceId === snapshot.workspaceId &&
    actual.generation === snapshot.generation &&
    actual.document.path === snapshot.document.path &&
    actual.document.uri === snapshot.document.uri &&
    actual.document.version === snapshot.document.version,
  );
}

function responseMatches(
  result: JavaSemanticResponseMetadata,
  semantics: JavaEditorSemantics,
): boolean {
  const snapshot = semantics.context;
  return Boolean(
    snapshot &&
    result.workspaceId === snapshot.workspaceId &&
    result.generation === snapshot.generation &&
    result.document.path === snapshot.document.path &&
    result.document.uri === snapshot.document.uri &&
    result.document.version === snapshot.document.version,
  );
}

type SemanticProviderRegistration = {
  api: typeof Monaco;
  editor: Monaco.editor.IStandaloneCodeEditor;
  model: Monaco.editor.ITextModel;
  filePath: string;
  semantics: JavaEditorSemantics;
  getCurrentSemantics: () => JavaEditorSemantics | undefined;
  selectCodeActionMembers?: (
    selection: JavaCodeActionMemberSelection,
  ) => Promise<JavaCodeActionGenerationSelection | null>;
  onWorkspaceDocumentChanges?: (changes: readonly JavaWorkspaceDocumentChange[]) => boolean;
};

/** Register model-guarded Java providers. Monaco registries are global, so every callback rechecks identity. */
/** Keep the typing provider alive while document-version synchronization advances. */
export function registerJavaOnTypeFormattingProvider(options: {
  api: typeof Monaco;
  editor: Monaco.editor.IStandaloneCodeEditor;
  model: Monaco.editor.ITextModel;
  filePath: string;
  scope: NonNullable<JavaEditorSemantics["context"]>;
  triggerCharacters: readonly string[];
  getCurrentSemantics(): JavaEditorSemantics | undefined;
}): Monaco.IDisposable {
  const { api, editor, model, filePath, scope, getCurrentSemantics } = options;
  let disposed = false;
  const pending = new Map<string, () => void>();
  const provider = api.languages.registerOnTypeFormattingEditProvider("java", {
    autoFormatTriggerCharacters: [...options.triggerCharacters],
    async provideOnTypeFormattingEdits(candidate, position, character, formatting, token) {
      const version = candidate.getVersionId();
      const text = candidate.getValue();
      const currentModel = () => !disposed && !candidate.isDisposed() && !token.isCancellationRequested && candidate === model &&
        editor.getModel() === model && candidate.getVersionId() === version &&
        candidate.getLanguageId() === "java" && uriOf(candidate) === scope.document.uri;
      const sameScope = (value: JavaEditorSemantics | undefined) => value?.context?.workspaceId === scope.workspaceId &&
        value.context.generation === scope.generation && value.context.document.path === filePath &&
        value.context.document.uri === scope.document.uri;
      const deadline = Date.now() + 500;
      let semantics = getCurrentSemantics();
      while (currentModel() && Date.now() < deadline &&
        (!sameScope(semantics) || semantics?.documentText !== text)) {
        await new Promise<void>(resolve => setTimeout(resolve, 10));
        semantics = getCurrentSemantics();
      }
      if (!currentModel() || !sameScope(semantics) || semantics?.documentText !== text ||
        !semantics.context || !semantics.formatOnType || !semantics.onTypeFormattingTriggers?.includes(character)) return [];
      const selected = semantics;
      const requestId = nextId("request"), cancellationId = nextId("cancel");
      let cancelled = false;
      const cancel = () => {
        cancelled = true;
        try { void Promise.resolve(selected.cancel(cancellationId)).catch(() => undefined); } catch { /* The result is already retired. */ }
      };
      pending.set(cancellationId, cancel);
      const subscription = token.onCancellationRequested(cancel);
      try {
        const request: JavaOnTypeFormattingRequest = {
          workspaceId: selected.context!.workspaceId, generation: selected.context!.generation,
          document: { ...selected.context!.document },
          position: { line: position.lineNumber - 1, character: position.column - 1 }, character,
          options: { tabSize: formatting.tabSize, insertSpaces: formatting.insertSpaces },
          requestId, cancellationId,
        };
        const response = await selected.formatOnType!(request);
        if (cancelled || !currentModel() || !sameContext(getCurrentSemantics(), selected) ||
          !getCurrentSemantics()?.onTypeFormattingTriggers?.includes(character) ||
          response.requestId !== requestId || !response.ok || !responseMatches(response.result, selected)) return [];
        const edits = response.result.edits.map(edit => {
          const range = toRange(candidate, edit.range);
          return range ? { range, text: edit.newText } : null;
        });
        if (edits.length > 2048 || edits.some(edit => edit === null) || edits.some((edit, index) =>
          edits.slice(0, index).some(previous => edit && previous && overlaps(edit.range, previous.range)))) return [];
        return edits as Monaco.languages.TextEdit[];
      } catch { return []; }
      finally { pending.delete(cancellationId); subscription.dispose(); }
    },
  });
  return { dispose() { if (disposed) return; disposed = true; provider.dispose(); for (const cancel of pending.values()) cancel(); pending.clear(); } };
}

export function registerJavaSemanticProviders({
  api,
  editor,
  model,
  filePath,
  semantics,
  getCurrentSemantics,
  selectCodeActionMembers,
  onWorkspaceDocumentChanges,
}: SemanticProviderRegistration): Monaco.IDisposable {
  const snapshot = semantics.context;
  if (!snapshot || snapshot.document.path !== filePath || uriOf(model) !== snapshot.document.uri) {
    return { dispose() {} };
  }

  let disposed = false;
  const pending = new Set<LanguageServiceCancellationId>();
  const matches = (candidate: Monaco.editor.ITextModel): boolean =>
    !disposed &&
    candidate === model &&
    uriOf(candidate) === snapshot.document.uri &&
    snapshot.document.path === filePath &&
    sameContext(getCurrentSemantics(), semantics);

  const cancel = (id: LanguageServiceCancellationId): void => {
    if (!pending.delete(id)) return;
    void Promise.resolve(semantics.cancel(id)).catch(() => undefined);
  };

  const commandId = `ide.java.applyCodeAction.${nextId("request")}`;
  type CodeActionCommandEntry =
    | { version: number; edits: Monaco.editor.IIdentifiedSingleEditOperation[] }
    | { version: number; workspaceEdits: MappedWorkspaceDocumentEdit[] }
    | {
        version: number;
        deferredAction: JavaCodeAction;
        range: LanguageRange;
        diagnostics: JavaCodeActionsRequest["diagnostics"];
      }
    | {
        version: number;
        action: JavaCodeAction;
        range: LanguageRange;
        diagnostics: JavaCodeActionsRequest["diagnostics"];
      };
  const codeActionCommands = new Map<string, CodeActionCommandEntry>();
  const applyCodeActionCommand = api.editor.registerCommand(commandId, (_accessor, key) => {
    if (typeof key !== "string") return;
    const entry = codeActionCommands.get(key);
    codeActionCommands.delete(key);
    if (
      !entry ||
      !matches(model) ||
      editor.getModel() !== model ||
      model.getVersionId() !== entry.version
    )
      return;
    if ("edits" in entry) {
      editor.executeEdits("java-code-action", entry.edits);
      return;
    }
    if ("workspaceEdits" in entry) {
      const currentModels = api.editor.getModels?.() ?? [model];
      if (
        !onWorkspaceDocumentChanges ||
        !entry.workspaceEdits.every(
          (target) =>
            currentModels.includes(target.model) &&
            !target.model.isDisposed() &&
            target.model.getVersionId() === target.version &&
            target.model.getValue() === target.before,
        )
      )
        return;
      const changes: JavaWorkspaceDocumentChange[] = entry.workspaceEdits.map((target) => ({
        filePath: target.filePath,
        before: target.before,
        after: target.after,
      }));
      if (!onWorkspaceDocumentChanges(changes)) return;
      for (const target of entry.workspaceEdits) {
        if (target.model === model && editor.getModel() === model) {
          editor.pushUndoStop();
          editor.executeEdits("java-code-action", target.edits);
          editor.pushUndoStop();
        } else {
          target.model.pushStackElement();
          target.model.pushEditOperations([], target.edits, () => null);
          target.model.pushStackElement();
        }
      }
      return;
    }
    if ("deferredAction" in entry) {
      const apply = semantics.applyCodeAction;
      if (!apply) return;
      const requestId = nextId("request");
      const cancellationId = nextId("cancel");
      pending.add(cancellationId);
      return apply({
        workspaceId: snapshot.workspaceId,
        generation: snapshot.generation,
        document: snapshot.document,
        position: entry.range.start,
        range: entry.range,
        diagnostics: entry.diagnostics,
        requestId,
        cancellationId,
        action: entry.deferredAction,
      })
        .then((applied) => {
          if (!applied)
            throw new Error(
              "The Java quick fix is unavailable or its source changed. Request code actions again.",
            );
        })
        .finally(() => pending.delete(cancellationId));
    }
    if (!selectCodeActionMembers) return;
    void (async () => {
      const selection = await selectCodeActionMembers(entry.action.memberSelection!);
      if (
        !selection ||
        selection.kind !== entry.action.memberSelection?.kind ||
        !validActionGenerationSelection(entry.action.memberSelection!, selection) ||
        !matches(model) ||
        editor.getModel() !== model ||
        model.getVersionId() !== entry.version
      )
        return;
      const requestId = nextId("request");
      const response = await semantics.codeActions({
        workspaceId: snapshot.workspaceId,
        generation: snapshot.generation,
        document: snapshot.document,
        position: entry.range.start,
        range: entry.range,
        diagnostics: entry.diagnostics,
        requestId,
        cancellationId: nextId("cancel"),
        generationSelection: selection,
      });
      if (
        !response.ok ||
        response.requestId !== requestId ||
        !responseMatches(response.result, semantics) ||
        !matches(model) ||
        editor.getModel() !== model ||
        model.getVersionId() !== entry.version
      )
        return;
      const generated = response.result.actions.find(
        (action) =>
          action.title === entry.action.title &&
          action.memberSelection === undefined &&
          (action.additionalEdits?.length ?? 0) === 0 &&
          action.edits.length > 0,
      );
      if (!generated) return;
      const edits = mapCodeActionEdits(model, generated.edits);
      if (!edits || model.getVersionId() !== entry.version) return;
      editor.executeEdits("java-code-action", edits);
    })().catch(() => undefined);
  });

  async function request<TResponse extends { requestId: string; ok: boolean }, TResult>(
    candidate: Monaco.editor.ITextModel,
    token: Monaco.CancellationToken,
    invoke: (requestId: string, cancellationId: string) => Promise<TResponse>,
    select: (response: TResponse) => TResult,
    empty: TResult,
  ): Promise<TResult> {
    if (!matches(candidate) || token.isCancellationRequested) return empty;
    const version = candidate.getVersionId();
    const requestId = nextId("request");
    const cancellationId = nextId("cancel");
    pending.add(cancellationId);
    let cancelled = false;
    const cancellation = token.onCancellationRequested(() => {
      cancelled = true;
      cancel(cancellationId);
    });
    try {
      const response = await invoke(requestId, cancellationId);
      pending.delete(cancellationId);
      if (
        cancelled ||
        token.isCancellationRequested ||
        !matches(candidate) ||
        candidate.getVersionId() !== version ||
        response.requestId !== requestId ||
        !response.ok
      )
        return empty;
      return select(response);
    } catch {
      pending.delete(cancellationId);
      return empty;
    } finally {
      cancellation.dispose();
    }
  }

  const baseRequest = (
    position: { lineNumber: number; column: number },
    requestId: string,
    cancellationId: string,
  ) => ({
    workspaceId: snapshot.workspaceId,
    generation: snapshot.generation,
    document: snapshot.document,
    position: { line: position.lineNumber - 1, character: position.column - 1 },
    requestId,
    cancellationId,
  });

  const completion = api.languages.registerCompletionItemProvider("java", {
    provideCompletionItems(candidate, position, context, token) {
      return request<JavaCompletionResponse, Monaco.languages.CompletionList>(
        candidate,
        token,
        (requestId, cancellationId) => {
          const trigger =
            context.triggerKind === 1
              ? { kind: "trigger-character" as const, character: context.triggerCharacter }
              : context.triggerKind === 2
                ? { kind: "incomplete-completions" as const }
                : { kind: "invoked" as const };
          return semantics.completion({
            ...baseRequest(position, requestId, cancellationId),
            trigger,
          } as JavaCompletionRequest);
        },
        (response) => {
          if (!response.ok || !responseMatches(response.result, semantics))
            return { suggestions: [] };
          return {
            incomplete: response.result.isIncomplete,
            suggestions: response.result.items.flatMap((item) => {
              const validEdit = item.textEdit ? toRange(candidate, item.textEdit.range) : undefined;
              if (item.textEdit && !validEdit) return [];
              const primaryRange = validEdit ?? {
                startLineNumber: position.lineNumber,
                startColumn: position.column,
                endLineNumber: position.lineNumber,
                endColumn: position.column,
              };
              const additionalTextEdits = mapJavaCompletionAdditionalEdits(
                candidate,
                item,
                snapshot.workspaceId,
                snapshot.document,
                primaryRange,
              );
              if (additionalTextEdits === null) return [];
              const suggestion: Monaco.languages.CompletionItem = {
                label: item.label,
                kind: COMPLETION_KINDS[item.kind],
                range: primaryRange,
                insertText: validEdit ? item.textEdit!.newText : (item.insertText ?? item.label),
                ...(additionalTextEdits.length ? { additionalTextEdits } : {}),
                ...(item.detail !== undefined ? { detail: item.detail } : {}),
                ...(item.documentation
                  ? { documentation: displayContent(item.documentation) }
                  : {}),
                ...(item.sortText !== undefined ? { sortText: item.sortText } : {}),
                ...(item.filterText !== undefined ? { filterText: item.filterText } : {}),
                ...(item.commitCharacters !== undefined
                  ? { commitCharacters: item.commitCharacters }
                  : {}),
                ...(item.deprecated !== undefined ? { tags: item.deprecated ? [1] : [] } : {}),
                ...(item.preselect !== undefined ? { preselect: item.preselect } : {}),
                ...(item.kind === "snippet" ? { insertTextRules: 4 } : {}),
              };
              return [suggestion];
            }),
          };
        },
        { suggestions: [] },
      );
    },
  });

  const documentSymbols = api.languages.registerDocumentSymbolProvider("java", {
    displayName: "Java",
    provideDocumentSymbols(candidate, token) {
      return request<JavaDocumentSymbolsResponse, Monaco.languages.DocumentSymbol[]>(
        candidate,
        token,
        (requestId, cancellationId) =>
          semantics.documentSymbols({
            workspaceId: snapshot.workspaceId,
            generation: snapshot.generation,
            document: snapshot.document,
            requestId,
            cancellationId,
          }),
        (response) => {
          if (
            !response.ok ||
            !responseMatches(response.result, semantics) ||
            response.result.isTruncated
          )
            return [];
          const symbols = response.result.symbols.map((symbol) =>
            mapDocumentSymbol(candidate, symbol),
          );
          return symbols.some((symbol) => !symbol)
            ? []
            : (symbols as Monaco.languages.DocumentSymbol[]);
        },
        [],
      );
    },
  });

  const documentHighlights = api.languages.registerDocumentHighlightProvider("java", {
    provideDocumentHighlights(candidate, position, token) {
      return request<JavaDocumentHighlightsResponse, Monaco.languages.DocumentHighlight[]>(
        candidate,
        token,
        (requestId, cancellationId) =>
          semantics.documentHighlights(baseRequest(position, requestId, cancellationId)),
        (response) => {
          if (
            !response.ok ||
            !responseMatches(response.result, semantics) ||
            response.result.isTruncated
          )
            return [];
          const kinds: Record<"text" | "read" | "write", Monaco.languages.DocumentHighlightKind> = {
            text: api.languages.DocumentHighlightKind.Text,
            read: api.languages.DocumentHighlightKind.Read,
            write: api.languages.DocumentHighlightKind.Write,
          };
          const highlights = response.result.highlights.map((highlight) => {
            const range = toRange(candidate, highlight.range);
            return range
              ? { range, ...(highlight.kind ? { kind: kinds[highlight.kind] } : {}) }
              : undefined;
          });
          return highlights.some((highlight) => !highlight)
            ? []
            : (highlights as Monaco.languages.DocumentHighlight[]);
        },
        [],
      );
    },
  });

  const semanticTokens = semantics.semanticTokensEnabled
    ? api.languages.registerDocumentSemanticTokensProvider("java", {
        getLegend: () => ({
          tokenTypes: SEMANTIC_TOKEN_TYPES,
          tokenModifiers: SEMANTIC_TOKEN_MODIFIERS,
        }),
        provideDocumentSemanticTokens(candidate, _lastResultId, token) {
          return request<JavaSemanticTokensResponse, Monaco.languages.SemanticTokens>(
            candidate,
            token,
            (requestId, cancellationId) =>
              semantics.semanticTokens({
                workspaceId: snapshot.workspaceId,
                generation: snapshot.generation,
                document: snapshot.document,
                requestId,
                cancellationId,
              }),
            (response) => {
              if (!response.ok || !responseMatches(response.result, semantics))
                return { data: new Uint32Array() };
              const typeIndexes = new Map(SEMANTIC_TOKEN_TYPES.map((type, index) => [type, index]));
              const modifierIndexes = new Map(
                SEMANTIC_TOKEN_MODIFIERS.map((modifier, index) => [modifier, index]),
              );
              const data: number[] = [];
              let previousLine = 0;
              let previousStart = 0;
              for (const semanticToken of response.result.tokens) {
                const typeIndex = typeIndexes.get(semanticToken.tokenType);
                const range = toRange(candidate, semanticToken.range);
                if (
                  typeIndex === undefined ||
                  !range ||
                  range.startLineNumber !== range.endLineNumber
                )
                  continue;
                let modifierBits = 0;
                for (const modifier of semanticToken.tokenModifiers) {
                  const index = modifierIndexes.get(modifier);
                  if (index !== undefined) modifierBits |= 1 << index;
                }
                const line = range.startLineNumber - 1;
                const start = range.startColumn - 1;
                data.push(
                  line - previousLine,
                  line === previousLine ? start - previousStart : start,
                  range.endColumn - range.startColumn,
                  typeIndex,
                  modifierBits,
                );
                previousLine = line;
                previousStart = start;
              }
              return { data: Uint32Array.from(data) };
            },
            { data: new Uint32Array() },
          );
        },
        releaseDocumentSemanticTokens() {},
      })
    : { dispose() {} };

  const hover = api.languages.registerHoverProvider("java", {
    provideHover(candidate, position, token) {
      return request<JavaHoverResponse, Monaco.languages.Hover | null>(
        candidate,
        token,
        (requestId, cancellationId) =>
          semantics.hover(baseRequest(position, requestId, cancellationId) as JavaHoverRequest),
        (response) => {
          if (!response.ok || !responseMatches(response.result, semantics)) return null;
          const range = response.result.range
            ? toRange(candidate, response.result.range)
            : undefined;
          return {
            contents: response.result.contents.map(displayContent),
            ...(range ? { range } : {}),
          };
        },
        null,
      );
    },
  });

  const signature = api.languages.registerSignatureHelpProvider("java", {
    signatureHelpTriggerCharacters: ["(", ","],
    provideSignatureHelp(candidate, position, token, _context) {
      return request<JavaSignatureHelpResponse, Monaco.languages.SignatureHelpResult | null>(
        candidate,
        token,
        (requestId, cancellationId) =>
          semantics.signatureHelp(
            baseRequest(position, requestId, cancellationId) as JavaSignatureHelpRequest,
          ),
        (response) => {
          if (!response.ok || !responseMatches(response.result, semantics)) return null;
          return {
            value: {
              signatures: response.result.signatures.map((entry) => ({
                label: entry.label,
                ...(entry.documentation
                  ? { documentation: displayContent(entry.documentation) }
                  : {}),
                parameters: entry.parameters.map((parameter) => ({
                  label:
                    typeof parameter.label === "string"
                      ? parameter.label
                      : ([parameter.label.start, parameter.label.end] as [number, number]),
                  ...(parameter.documentation
                    ? { documentation: displayContent(parameter.documentation) }
                    : {}),
                })),
                ...(entry.activeParameter !== undefined
                  ? { activeParameter: entry.activeParameter }
                  : {}),
              })),
              activeSignature: response.result.activeSignature ?? 0,
              activeParameter: response.result.activeParameter ?? 0,
            },
            dispose() {},
          };
        },
        null,
      );
    },
  });

  const codeActions = api.languages.registerCodeActionProvider(
    "java",
    {
      provideCodeActions(candidate, requestedRange, context, token) {
        const version = candidate.getVersionId();
        const diagnostics = context.markers.slice(0, 100).flatMap((marker) => {
          const severity =
            marker.severity === api.MarkerSeverity.Error
              ? 1
              : marker.severity === api.MarkerSeverity.Warning
                ? 2
                : marker.severity === api.MarkerSeverity.Info
                  ? 3
                  : marker.severity === api.MarkerSeverity.Hint
                    ? 4
                    : undefined;
          if (severity === undefined || new TextEncoder().encode(marker.message).length > 8_192)
            return [];
          const markerRange = toRange(candidate, {
            start: { line: marker.startLineNumber - 1, character: marker.startColumn - 1 },
            end: { line: marker.endLineNumber - 1, character: marker.endColumn - 1 },
          });
          if (!markerRange) return [];
          const rawCode = marker.code;
          const code =
            typeof rawCode === "string" || typeof rawCode === "number"
              ? rawCode
              : rawCode && typeof rawCode === "object" && "value" in rawCode
                ? rawCode.value
                : undefined;
          return [
            {
              range: {
                start: {
                  line: markerRange.startLineNumber - 1,
                  character: markerRange.startColumn - 1,
                },
                end: { line: markerRange.endLineNumber - 1, character: markerRange.endColumn - 1 },
              },
              severity: severity as 1 | 2 | 3 | 4,
              message: marker.message,
              ...(marker.source && new TextEncoder().encode(marker.source).length <= 256
                ? { source: marker.source }
                : {}),
              ...(typeof code === "number" ||
              (typeof code === "string" && new TextEncoder().encode(code).length <= 256)
                ? { code }
                : {}),
            },
          ];
        });
        const range: LanguageRange = {
          start: {
            line: requestedRange.startLineNumber - 1,
            character: requestedRange.startColumn - 1,
          },
          end: { line: requestedRange.endLineNumber - 1, character: requestedRange.endColumn - 1 },
        };
        const initialModels = [...new Set([...(api.editor.getModels?.() ?? []), candidate])].filter(
          (opened) => opened === candidate || opened.getLanguageId() === "java",
        );
        const modelsByUri = new Map(initialModels.map((opened) => [opened.uri.toString(), opened]));
        const versionsByUri = new Map(
          initialModels.map((opened) => [opened.uri.toString(), opened.getVersionId()]),
        );
        return request<JavaCodeActionsResponse, Monaco.languages.CodeActionList>(
          candidate,
          token,
          (requestId, cancellationId) =>
            semantics.codeActions({
              ...baseRequest(
                { lineNumber: requestedRange.startLineNumber, column: requestedRange.startColumn },
                requestId,
                cancellationId,
              ),
              range,
              diagnostics,
            } as JavaCodeActionsRequest),
          (response) => {
            if (!response.ok || !responseMatches(response.result, semantics))
              return { actions: [], dispose() {} };
            const actions: Monaco.languages.CodeAction[] = [];
            for (const action of response.result.actions) {
              if (action.documentsToOpen) {
                if (!semantics.applyCodeAction) continue;
                const key = nextId("request");
                codeActionCommands.set(key, {
                  version,
                  deferredAction: action,
                  range,
                  diagnostics,
                });
                actions.push({
                  title: action.title,
                  ...(action.kind ? { kind: action.kind } : {}),
                  ...(action.isPreferred ? { isPreferred: true } : {}),
                  command: { id: commandId, title: action.title, arguments: [key] },
                });
                continue;
              }
              if (action.memberSelection && !selectCodeActionMembers) continue;
              const workspaceEdits = action.memberSelection
                ? null
                : mapCodeActionWorkspaceEdits(
                    candidate,
                    action,
                    snapshot.workspaceId,
                    snapshot.document,
                    modelsByUri,
                    versionsByUri,
                    [...new Set([...(api.editor.getModels?.() ?? []), candidate])],
                  );
              if (!action.memberSelection && !workspaceEdits) continue;
              const hasAdditionalEdits = (action.additionalEdits?.length ?? 0) > 0;
              if (hasAdditionalEdits && workspaceEdits) {
                if (!onWorkspaceDocumentChanges) continue;
                const key = nextId("request");
                codeActionCommands.set(key, { version, workspaceEdits });
                actions.push({
                  title: action.title,
                  ...(action.kind ? { kind: action.kind } : {}),
                  ...(action.isPreferred ? { isPreferred: true } : {}),
                  command: { id: commandId, title: action.title, arguments: [key] },
                });
                continue;
              }
              const edits = action.memberSelection
                ? null
                : mapCodeActionEdits(candidate, action.edits);
              if (!action.memberSelection && !edits) continue;
              const key = nextId("request");
              codeActionCommands.set(
                key,
                action.memberSelection
                  ? { version, action, range, diagnostics }
                  : { version, edits: edits! },
              );
              actions.push({
                title: action.title,
                ...(action.kind ? { kind: action.kind } : {}),
                ...(action.isPreferred ? { isPreferred: true } : {}),
                command: { id: commandId, title: action.title, arguments: [key] },
              });
            }
            while (codeActionCommands.size > 200)
              codeActionCommands.delete(codeActionCommands.keys().next().value as string);
            return { actions, dispose() {} };
          },
          { actions: [], dispose() {} },
        );
      },
    },
    {
      providedCodeActionKinds: ["quickfix", "quickassist", "refactor", "source"],
    },
  );

  const renameProvider = semantics.rename
    ? api.languages.registerRenameProvider("java", {
        provideRenameEdits(candidate, position, newName, token) {
          const initialModels = api.editor.getModels?.() ?? [candidate];
          const modelVersions = new Map(
            [...initialModels, candidate].map((model) => [
              model.uri.toString(),
              model.getVersionId(),
            ]),
          );
          return request<
            JavaRenameResponse,
            Monaco.languages.WorkspaceEdit & Monaco.languages.Rejection
          >(
            candidate,
            token,
            (requestId, cancellationId) =>
              semantics.rename!({
                ...baseRequest(position, requestId, cancellationId),
                newName,
              } as JavaRenameRequest),
            (response) => {
              if (!response.ok || !responseMatches(response.result, semantics))
                return { edits: [] };
              if (response.result.appliedToEditor) return { edits: [] };
              const edits: Monaco.languages.IWorkspaceTextEdit[] = [];
              for (const documentEdit of response.result.documentEdits) {
                const resource = documentEdit.document.uri;
                const model =
                  candidate.uri.toString() === resource
                    ? candidate
                    : (api.editor.getModels?.() ?? []).find(
                        (opened) => opened.uri.toString() === resource,
                      );
                const initialVersion = modelVersions.get(resource);
                if (
                  !model ||
                  initialVersion === undefined ||
                  model.getVersionId() !== initialVersion
                )
                  return { edits: [] };
                const mapped = mapCodeActionEdits(model, documentEdit.edits);
                if (!mapped) return { edits: [] };
                for (const edit of mapped) {
                  if (typeof edit.text !== "string") return { edits: [] };
                  edits.push({
                    resource: model.uri,
                    textEdit: { range: edit.range, text: edit.text },
                    versionId: initialVersion,
                  });
                }
              }
              return { edits };
            },
            { edits: [] },
          );
        },
      })
    : undefined;
  const formattingProvider =
    semantics.formattingEnabled && semantics.formatDocument
      ? api.languages.registerDocumentFormattingEditProvider("java", {
          provideDocumentFormattingEdits(candidate, options, token) {
            return request<JavaFormattingResponse, Monaco.languages.TextEdit[]>(
              candidate,
              token,
              (requestId, cancellationId) => {
                const formattingRequest: JavaFormattingRequest = {
                  workspaceId: snapshot.workspaceId,
                  generation: snapshot.generation,
                  document: { ...snapshot.document },
                  options: { tabSize: options.tabSize, insertSpaces: options.insertSpaces },
                  requestId,
                  cancellationId,
                };
                return semantics.formatDocument!(formattingRequest);
              },
              (response) => {
                if (!response.ok || !responseMatches(response.result, semantics)) return [];
                const edits = response.result.edits.map((edit) => {
                  const range = toRange(candidate, edit.range);
                  return range ? { range, text: edit.newText } : null;
                });
                if (
                  edits.length > 2_048 ||
                  edits.some((edit) => edit === null) ||
                  edits.some((edit, index) =>
                    edits
                      .slice(0, index)
                      .some((previous) => edit && previous && overlaps(edit.range, previous.range)),
                  )
                )
                  return [];
                return edits as Monaco.languages.TextEdit[];
              },
              [],
            );
          },
        })
      : undefined;
  const renameAction = renameProvider
    ? editor.addAction({
        id: "ide.java.renameSymbolInCurrentDocument",
        label: "Rename Java Symbol…",
        keybindings: [api.KeyMod.CtrlCmd | api.KeyMod.Alt | api.KeyMod.Shift | api.KeyCode.KeyR],
        keybindingContext: "editorTextFocus",
        contextMenuGroupId: "1_modification",
        contextMenuOrder: 1.2,
        run: () => editor.trigger("java-semantic-rename", "editor.action.rename", {}),
      })
    : undefined;
  const rangeFormattingProvider =
    semantics.rangeFormattingEnabled && semantics.formatRange
      ? api.languages.registerDocumentRangeFormattingEditProvider("java", {
          provideDocumentRangeFormattingEdits(candidate, selectedRange, options, token) {
            const range: LanguageRange = {
              start: {
                line: selectedRange.startLineNumber - 1,
                character: 0,
              },
              end: {
                line: selectedRange.endLineNumber - 1,
                character: candidate.getLineMaxColumn(selectedRange.endLineNumber) - 1,
              },
            };
            if (
              range.start.line === range.end.line &&
              range.start.character === range.end.character
            )
              return [];
            return request<JavaRangeFormattingResponse, Monaco.languages.TextEdit[]>(
              candidate,
              token,
              (requestId, cancellationId) => {
                const formattingRequest: JavaRangeFormattingRequest = {
                  workspaceId: snapshot.workspaceId,
                  generation: snapshot.generation,
                  document: { ...snapshot.document },
                  range,
                  options: { tabSize: options.tabSize, insertSpaces: options.insertSpaces },
                  requestId,
                  cancellationId,
                };
                return semantics.formatRange!(formattingRequest);
              },
              (response) => {
                if (!response.ok || !responseMatches(response.result, semantics)) return [];
                const edits = response.result.edits.map((edit) => {
                  const editRange = toRange(candidate, edit.range);
                  return editRange && languageRangeContains(range, edit.range)
                    ? { range: editRange, text: edit.newText }
                    : null;
                });
                if (
                  edits.length > 2_048 ||
                  edits.some((edit) => edit === null) ||
                  edits.some((edit, index) =>
                    edits
                      .slice(0, index)
                      .some((previous) => edit && previous && overlaps(edit.range, previous.range)),
                  )
                )
                  return [];
                return edits as Monaco.languages.TextEdit[];
              },
              [],
            );
          },
        })
      : undefined;

  const inlayHintsProvider = semantics.inlayHints
    ? api.languages.registerInlayHintsProvider("java", {
        displayName: "Java",
        provideInlayHints(candidate, visibleRange, token) {
          const range: LanguageRange = {
            start: {
              line: visibleRange.startLineNumber - 1,
              character: visibleRange.startColumn - 1,
            },
            end: {
              line: visibleRange.endLineNumber - 1,
              character: visibleRange.endColumn - 1,
            },
          };
          if (range.start.line === range.end.line && range.start.character === range.end.character)
            return { hints: [], dispose() {} };
          return request<JavaInlayHintsResponse, Monaco.languages.InlayHintList>(
            candidate,
            token,
            (requestId, cancellationId) => {
              const inlayRequest: JavaInlayHintsRequest = {
                workspaceId: snapshot.workspaceId,
                generation: snapshot.generation,
                document: { ...snapshot.document },
                range,
                requestId,
                cancellationId,
              };
              return semantics.inlayHints!(inlayRequest);
            },
            (response) => {
              if (!response.ok || !responseMatches(response.result, semantics))
                return { hints: [], dispose() {} };
              const hints = response.result.hints.flatMap((hint) => {
                if (!isValidPosition(candidate, hint.position.line, hint.position.character))
                  return [];
                return [
                  {
                    position: {
                      lineNumber: hint.position.line + 1,
                      column: hint.position.character + 1,
                    },
                    label: hint.label,
                    ...(hint.kind
                      ? {
                          kind:
                            hint.kind === "parameter"
                              ? api.languages.InlayHintKind.Parameter
                              : api.languages.InlayHintKind.Type,
                        }
                      : {}),
                    ...(hint.paddingLeft !== undefined ? { paddingLeft: hint.paddingLeft } : {}),
                    ...(hint.paddingRight !== undefined ? { paddingRight: hint.paddingRight } : {}),
                  },
                ];
              });
              return { hints, dispose() {} };
            },
            { hints: [], dispose() {} },
          );
        },
      })
    : undefined;

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      completion.dispose();
      documentSymbols.dispose();
      documentHighlights.dispose();
      semanticTokens.dispose();
      hover.dispose();
      signature.dispose();
      codeActions.dispose();
      renameProvider?.dispose();
      formattingProvider?.dispose();
      rangeFormattingProvider?.dispose();
      inlayHintsProvider?.dispose();
      renameAction?.dispose();
      applyCodeActionCommand.dispose();
      codeActionCommands.clear();
      [...pending].forEach(cancel);
    },
  };
}
