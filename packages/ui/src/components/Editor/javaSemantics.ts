import type {
  JavaCompletionItemKind,
  JavaCompletionRequest,
  JavaCompletionResponse,
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
import type { JavaEditorSemantics } from "./Editor";

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
  model: Monaco.editor.ITextModel;
  filePath: string;
  semantics: JavaEditorSemantics;
  getCurrentSemantics: () => JavaEditorSemantics | undefined;
};

/** Register model-guarded Java providers. Monaco registries are global, so every callback rechecks identity. */
export function registerJavaSemanticProviders({
  api,
  model,
  filePath,
  semantics,
  getCurrentSemantics,
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

  async function request<TResponse extends { requestId: string; ok: boolean }, TResult>(
    candidate: Monaco.editor.ITextModel,
    token: Monaco.CancellationToken,
    invoke: (requestId: string, cancellationId: string) => Promise<TResponse>,
    select: (response: TResponse) => TResult,
    empty: TResult,
  ): Promise<TResult> {
    if (!matches(candidate) || token.isCancellationRequested) return empty;
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

  const baseRequest = (position: Monaco.Position, requestId: string, cancellationId: string) => ({
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
            suggestions: response.result.items.map((item) => {
              const validEdit = item.textEdit ? toRange(candidate, item.textEdit.range) : undefined;
              const suggestion: Monaco.languages.CompletionItem = {
                label: item.label,
                kind: COMPLETION_KINDS[item.kind],
                range: validEdit ?? {
                  startLineNumber: position.lineNumber,
                  startColumn: position.column,
                  endLineNumber: position.lineNumber,
                  endColumn: position.column,
                },
                insertText: validEdit ? item.textEdit!.newText : (item.insertText ?? item.label),
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
              // Safe policy: additional/cross-document edits and commands are intentionally never mapped.
              return suggestion;
            }),
          };
        },
        { suggestions: [] },
      );
    },
  });

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

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      completion.dispose();
      hover.dispose();
      signature.dispose();
      [...pending].forEach(cancel);
    },
  };
}
