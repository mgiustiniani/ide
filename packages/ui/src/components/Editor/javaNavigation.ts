import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api";
import type {
  JavaNavigationLocation,
  JavaNavigationRequest,
  JavaLibraryDefinition,
  JavaDefinitionsRequest,
  JavaReferencesRequest,
  JavaReferenceLocation,
  JavaSemanticRequest,
} from "@ide/contracts";
import type { JavaEditorNavigation, JavaEditorSemantics } from "./Editor";
import { getMonacoLanguage } from "./monacoLanguage";

let sequence = 0;
let definitionProviderSequence = 0;

/** Monaco receives immutable source views; application navigation opens the real workspace buffer. */
export function registerJavaNavigationProviders({
  api,
  editor,
  model,
  filePath,
  navigation,
  getCurrentNavigation,
  getCurrentSemantics,
  onNavigationStatus,
  getNavigateJavaDefinition,
}: {
  api: typeof Monaco;
  editor: Monaco.editor.IStandaloneCodeEditor;
  model: Monaco.editor.ITextModel;
  filePath: string;
  navigation: JavaEditorNavigation;
  getCurrentNavigation(): JavaEditorNavigation | undefined;
  getCurrentSemantics(): JavaEditorSemantics | undefined;
  onNavigationStatus?(message: string | null): void;
  getNavigateJavaDefinition?(): ((
    location: JavaReferenceLocation,
    isCurrent: (afterOpen: boolean) => boolean,
  ) => boolean | Promise<boolean>) | undefined;
}): Monaco.IDisposable {
  let disposed = false;
  const previews = new Map<
    string,
    { model: Monaco.editor.ITextModel; requestId: string; location: JavaNavigationLocation }
  >();
  const batches: string[][] = [];
  const libraryPreviews = new Map<
    string,
    { model: Monaco.editor.ITextModel; definition: JavaLibraryDefinition }
  >();
  const languageServiceLocations = new Map<
    string,
    {
      location: JavaReferenceLocation;
      sourceVersion: number;
      sourcePosition: Monaco.Position;
      semanticContext: NonNullable<JavaEditorSemantics["context"]>;
      references?: { locations: JavaReferenceLocation[]; text: string };
    }
  >();
  const languageServicePreviews = new Map<string, Monaco.editor.ITextModel>();
  const languageServiceBatches: string[][] = [];
  const retire = (uri: string) => {
    previews.get(uri)?.model.dispose();
    previews.delete(uri);
    libraryPreviews.get(uri)?.model.dispose();
    libraryPreviews.delete(uri);
    languageServiceLocations.delete(uri);
    languageServicePreviews.get(uri)?.dispose();
    languageServicePreviews.delete(uri);
  };
  const retainLanguageServiceLocations = (uris: string[]) => {
    if (uris.length === 0) return;
    languageServiceBatches.push(uris);
    while (languageServiceBatches.length > 2)
      for (const uri of languageServiceBatches.shift()!) retire(uri);
  };
  const pending = new Map<string, () => void>();
  const editors = new Map<Monaco.editor.ICodeEditor, Monaco.IDisposable>();
  function watchPreviewEditor(editor: Monaco.editor.ICodeEditor) {
    if (editors.has(editor)) return;
    let previousOptions: { readOnly: boolean; domReadOnly: boolean } | undefined;
    const restore = () => {
      if (previousOptions) editor.updateOptions(previousOptions);
      previousOptions = undefined;
    };
    const enforce = () => {
      const uri = editor.getModel()?.uri.toString();
      if (uri && (previews.has(uri) || libraryPreviews.has(uri) || languageServicePreviews.has(uri))) {
        if (!previousOptions)
          previousOptions = {
            readOnly: editor.getOption(api.editor.EditorOption.readOnly),
            domReadOnly: editor.getOption(api.editor.EditorOption.domReadOnly),
          };
        editor.updateOptions({ readOnly: true, domReadOnly: true });
      } else restore();
    };
    const change = editor.onDidChangeModel(enforce);
    const close = editor.onDidDispose(() => {
      change.dispose();
      editors.delete(editor);
    });
    editors.set(editor, {
      dispose() {
        change.dispose();
        close.dispose();
        restore();
      },
    });
    enforce();
  }
  for (const editor of api.editor.getEditors()) watchPreviewEditor(editor);
  const newEditor = api.editor.onDidCreateEditor(watchPreviewEditor);
  const findReferences = editor.addAction({
    id: "ide.java.findReferences",
    label: "Find Java References",
    keybindings: [api.KeyMod.Shift | api.KeyCode.F12],
    keybindingContext: "editorTextFocus",
    contextMenuGroupId: "navigation",
    contextMenuOrder: 1.46,
    run: () => editor.trigger("java-navigation", "editor.action.referenceSearch.trigger", {}),
  });
  const matches = (candidate: Monaco.editor.ITextModel) =>
    !disposed &&
    candidate === model &&
    !model.isDisposed() &&
    getCurrentNavigation()?.context.workspaceId === navigation.context.workspaceId &&
    getCurrentNavigation()?.context.generation === navigation.context.generation;

  async function tryJdtDefinition(
    candidate: Monaco.editor.ITextModel,
    point: Monaco.Position,
    sourceVersion: number,
    token: Monaco.CancellationToken,
    kind: "definition" | "typeDefinition" = "definition",
  ): Promise<{ locations?: Monaco.languages.Location[]; reason?: string }> {
    const semantics = getCurrentSemantics();
    const queryLocations = kind === "typeDefinition" ? semantics?.typeDefinitions : semantics?.definitions;
    const label = kind === "typeDefinition" ? "type definition" : "definition";
    const currentContext = semantics?.context;
    const context = currentContext
      ? { ...currentContext, document: { ...currentContext.document } }
      : undefined;
    const matchesContext = (value: JavaEditorSemantics["context"]) =>
      Boolean(
        context &&
          value &&
          value.workspaceId === context.workspaceId &&
          value.workspaceId === navigation.context.workspaceId &&
          value.generation === context.generation &&
          value.document.path === filePath &&
          value.document.uri === candidate.uri.toString() &&
          value.document.version === sourceVersion &&
          value.document.path === context.document.path &&
          value.document.uri === context.document.uri &&
          value.document.version === context.document.version,
      );
    if (
      !semantics ||
      !queryLocations ||
      !context ||
      !getNavigateJavaDefinition?.() ||
      !matchesContext(context) ||
      token.isCancellationRequested ||
      !matches(candidate) ||
      candidate.getVersionId() !== sourceVersion
    )
      return {};

    const requestId = `java-${kind}-fallback-${++sequence}`;
    const cancellationId = `${requestId}-cancel`;
    const request: JavaDefinitionsRequest = {
      workspaceId: context.workspaceId,
      generation: context.generation,
      document: { ...context.document },
      position: { line: point.lineNumber - 1, character: point.column - 1 },
      requestId,
      cancellationId,
    };
    let cancelled = false;
    const cancellation = token.onCancellationRequested(() => {
      cancelled = true;
      try {
        void Promise.resolve(semantics.cancel(cancellationId)).catch(() => {});
      } catch {
        /* Cancellation is best-effort; stale responses remain rejected below. */
      }
    });
    const isCurrent = (afterOpen: boolean) => {
      const activeNavigation = getCurrentNavigation();
      const workspaceCurrent =
        activeNavigation?.context.workspaceId === navigation.context.workspaceId &&
        activeNavigation.context.generation === navigation.context.generation;
      if (cancelled || token.isCancellationRequested || !workspaceCurrent) return false;
      if (afterOpen) return candidate.isDisposed() || candidate.getVersionId() === sourceVersion;
      return (
        matches(candidate) &&
        candidate.getVersionId() === sourceVersion &&
        editor.getModel() === candidate &&
        editor.getPosition()?.lineNumber === point.lineNumber &&
        editor.getPosition()?.column === point.column &&
        matchesContext(getCurrentSemantics()?.context)
      );
    };
    try {
      const response = await queryLocations.call(semantics, request);
      const latestSemantics = getCurrentSemantics();
      if (
        !isCurrent(false) ||
        !matchesContext(latestSemantics?.context) ||
        !response.ok ||
        response.requestId !== requestId ||
        response.result.workspaceId !== context.workspaceId ||
        response.result.generation !== context.generation ||
        response.result.document.path !== context.document.path ||
        response.result.document.uri !== context.document.uri ||
        response.result.document.version !== sourceVersion
      )
        return {
          reason:
            !response.ok && response.requestId === requestId
              ? response.error.summary ?? `JDT LS could not resolve this ${label}.`
              : `JDT LS returned a stale or uncorrelated ${label} result.`,
        };
      const location = response.result.locations[0];
      if (!location) return { reason: `JDT LS found no workspace ${label}.` };
      if (!isCurrent(false)) return {};
      const uri = api.Uri.from({
        scheme: "ide-java-jdtls-definition",
        authority: requestId,
        path: `/${location.path}`,
      });
      languageServiceLocations.set(uri.toString(), {
        location,
        sourceVersion,
        sourcePosition: point,
        semanticContext: { ...context, document: { ...context.document } },
      });
      retainLanguageServiceLocations([uri.toString()]);
      return {
        locations: [
          {
            uri,
            range: new api.Range(
              location.range.start.line + 1,
              location.range.start.character + 1,
              location.range.end.line + 1,
              location.range.end.character + 1,
            ),
          },
        ],
      };
    } catch {
      return { reason: `The JDT LS ${label} request failed.` };
    } finally {
      cancellation.dispose();
    }
  }

  async function tryJdtReferences(
    candidate: Monaco.editor.ITextModel,
    point: Monaco.Position,
    sourceVersion: number,
    includeDeclaration: boolean,
    token: Monaco.CancellationToken,
  ): Promise<{ locations?: Monaco.languages.Location[]; reason?: string }> {
    const semantics = getCurrentSemantics();
    const sourceNavigation = getCurrentNavigation();
    const currentContext = semantics?.context;
    const context = currentContext
      ? { ...currentContext, document: { ...currentContext.document } }
      : undefined;
    const matchesContext = (value: JavaEditorSemantics["context"]) =>
      Boolean(
        context &&
          value &&
          value.workspaceId === context.workspaceId &&
          value.workspaceId === navigation.context.workspaceId &&
          value.generation === context.generation &&
          value.document.path === filePath &&
          value.document.uri === candidate.uri.toString() &&
          value.document.version === sourceVersion &&
          value.document.path === context.document.path &&
          value.document.uri === context.document.uri &&
          value.document.version === context.document.version,
      );
    if (
      !semantics?.references ||
      !sourceNavigation?.readSource ||
      !context ||
      !getNavigateJavaDefinition?.() ||
      !matchesContext(context) ||
      token.isCancellationRequested ||
      !matches(candidate) ||
      candidate.getVersionId() !== sourceVersion
    )
      return {};

    const requestId = `java-references-fallback-${++sequence}`;
    const cancellationId = `${requestId}-cancel`;
    const request: JavaReferencesRequest = {
      workspaceId: context.workspaceId,
      generation: context.generation,
      document: { ...context.document },
      position: { line: point.lineNumber - 1, character: point.column - 1 },
      requestId,
      cancellationId,
      includeDeclaration,
    };
    let cancelled = false;
    const cancellation = token.onCancellationRequested(() => {
      cancelled = true;
      try {
        void Promise.resolve(semantics.cancel(cancellationId)).catch(() => {});
      } catch {
        /* Cancellation is best-effort; stale responses remain rejected below. */
      }
    });
    const isCurrent = (afterOpen: boolean) => {
      const activeNavigation = getCurrentNavigation();
      const workspaceCurrent =
        activeNavigation?.context.workspaceId === navigation.context.workspaceId &&
        activeNavigation.context.generation === navigation.context.generation;
      if (cancelled || token.isCancellationRequested || !workspaceCurrent) return false;
      if (afterOpen) return candidate.isDisposed() || candidate.getVersionId() === sourceVersion;
      return (
        matches(candidate) &&
        candidate.getVersionId() === sourceVersion &&
        editor.getModel() === candidate &&
        editor.getPosition()?.lineNumber === point.lineNumber &&
        editor.getPosition()?.column === point.column &&
        matchesContext(getCurrentSemantics()?.context)
      );
    };
    const created: string[] = [];
    try {
      const response = await semantics.references(request);
      const latestSemantics = getCurrentSemantics();
      if (
        !isCurrent(false) ||
        !matchesContext(latestSemantics?.context) ||
        !response.ok ||
        response.requestId !== requestId ||
        response.result.workspaceId !== context.workspaceId ||
        response.result.generation !== context.generation ||
        response.result.document.path !== context.document.path ||
        response.result.document.uri !== context.document.uri ||
        response.result.document.version !== sourceVersion
      )
        return {
          reason:
            !response.ok && response.requestId === requestId
              ? response.error.summary ?? "JDT LS could not find Java references."
              : "JDT LS returned stale or uncorrelated reference results.",
        };
      if (response.result.locations.length === 0)
        return { reason: "JDT LS found no workspace references." };

      const paths = [...new Set(response.result.locations.map((location) => location.path))];
      if (paths.length > 200)
        return { reason: "The reference preview exceeds the workspace file limit." };
      const sources = new Map<string, string>();
      let bytes = 0;
      for (const path of paths) {
        const text = await sourceNavigation.readSource(path, () => isCurrent(false));
        if (!isCurrent(false)) return {};
        if (text === null)
          return { reason: "Workspace source is unavailable for the reference preview." };
        const sourceBytes = new TextEncoder().encode(text).byteLength;
        if (sourceBytes > 1024 * 1024)
          return { reason: "A reference preview source exceeds the file text limit." };
        bytes += sourceBytes;
        if (bytes > 8 * 1024 * 1024)
          return { reason: "The reference preview exceeds the workspace text limit." };
        sources.set(path, text);
      }
      for (const location of response.result.locations) {
        const lines = sources.get(location.path)!.split(/\r\n|\r|\n/);
        if ([location.range.start, location.range.end].some(
          (position) => lines[position.line] === undefined || position.character > lines[position.line]!.length,
        ))
          return { reason: "A JDT LS reference range no longer matches the workspace source." };
      }
      const uris = new Map<string, Monaco.Uri>();
      for (const [path, text] of sources) {
        const uri = api.Uri.from({
          scheme: "ide-java-jdtls-reference",
          authority: requestId,
          path: `/${path}`,
        });
        const key = uri.toString();
        const preview = api.editor.createModel(text, "java", uri);
        created.push(key);
        languageServicePreviews.set(key, preview);
        const fileLocations = response.result.locations.filter((location) => location.path === path);
        languageServiceLocations.set(key, {
          location: fileLocations[0]!,
          references: { locations: fileLocations, text },
          sourceVersion,
          sourcePosition: point,
          semanticContext: { ...context, document: { ...context.document } },
        });
        uris.set(path, uri);
      }
      const locations = response.result.locations.map((location) => {
        return {
          uri: uris.get(location.path)!,
          range: new api.Range(
            location.range.start.line + 1,
            location.range.start.character + 1,
            location.range.end.line + 1,
            location.range.end.character + 1,
          ),
        };
      });
      retainLanguageServiceLocations(created);
      return {
        locations,
        ...(response.result.isTruncated
          ? { reason: "JDT LS returned a partial set of Java references." }
          : {}),
      };
    } catch {
      for (const uri of created) retire(uri);
      return { reason: "The JDT LS reference request failed." };
    } finally {
      cancellation.dispose();
    }
  }

  const dependencySource = navigation.openDependencySource
    ? editor.addAction({
        id: "ide.java.openDependencySource",
        label: "Open source",
        contextMenuGroupId: "navigation",
        contextMenuOrder: 1.47,
        run: async () => {
          const point = editor.getPosition();
          if (!point || editor.getModel() !== model || !matches(model)) return;
          await getCurrentNavigation()?.openDependencySource?.({
            ...navigation.context,
            requestId: `java-library-${++sequence}`,
            kind: "definition",
            document: { path: filePath, text: model.getValue(), version: model.getVersionId() },
            position: { line: point.lineNumber - 1, character: point.column - 1 },
            includeDeclaration: true,
            limit: 1,
          });
        },
      })
    : undefined;

  async function query(
    candidate: Monaco.editor.ITextModel,
    point: Monaco.Position,
    kind: JavaNavigationRequest["kind"],
    includeDeclaration: boolean,
    token: Monaco.CancellationToken,
    providerRegistrationId?: string,
  ) {
    const navigation = getCurrentNavigation();
    if (!navigation || !matches(candidate) || token.isCancellationRequested) return null;
    onNavigationStatus?.(null);
    const version = candidate.getVersionId();
    const requestId = `java-position-${++sequence}`;
    const requestStarted = performance.now();
    if (kind === "definition" && providerRegistrationId)
      appendNavigationEvidence("data-java-definition-provider-history", {
        event: "request",
        atMs: Math.round(requestStarted),
        registrationId: providerRegistrationId,
        requestId,
        model: candidate.uri.toString(),
        version,
        line: point.lineNumber,
        column: point.column,
      });
    let cancelled = false;
    const cancel = token.onCancellationRequested(() => {
      cancelled = true;
      if (kind === "definition" && providerRegistrationId)
        appendNavigationEvidence("data-java-definition-provider-history", {
          event: "token-cancelled",
          atMs: Math.round(performance.now()),
          elapsedMs: Math.round(performance.now() - requestStarted),
          registrationId: providerRegistrationId,
          requestId,
        });
      navigation.cancel(requestId);
    });
    const batch: string[] = [];
    const requestIsCurrent = () =>
      !cancelled && !token.isCancellationRequested &&
      matches(candidate) && candidate.getVersionId() === version &&
      (kind !== "typeDefinition" ||
        getCurrentNavigation()?.typeDefinitionAvailable === true ||
        Boolean(getCurrentSemantics()?.typeDefinitions));
    try {
      if (!requestIsCurrent()) return null;
      if (kind === "typeDefinition" && !navigation.typeDefinitionAvailable) {
        const fallback = await tryJdtDefinition(candidate, point, version, token, kind);
        if (!requestIsCurrent()) return null;
        onNavigationStatus?.(fallback.reason ?? null);
        return fallback.locations ?? null;
      }
      pending.set(requestId, () => navigation.cancel(requestId));
      const request: JavaNavigationRequest = {
        ...navigation.context,
        requestId,
        kind,
        document: { path: filePath, text: candidate.getValue(), version },
        position: { line: point.lineNumber - 1, character: point.column - 1 },
        includeDeclaration,
        limit: kind === "references" ? 1000 : 1,
      };
      const result = await navigation.query(request);
      if (kind === "definition") {
        recordNavigationEvidence("data-java-definition-result-status", result.status);
        recordNavigationEvidence(
          "data-java-definition-result-message",
          "message" in result ? result.message : null,
        );
        recordNavigationEvidence("data-java-dependency-definition-result-status", null);
        const body = editorNode?.ownerDocument?.body;
        if (body?.hasAttribute("data-native-java-navigation-diagnostics")) {
          let history: Array<{
            requestId: string;
            status: string;
            message?: string;
            refusalCode?: string;
          }> = [];
          try {
            const value = JSON.parse(
              body.getAttribute("data-java-definition-result-history") ?? "[]",
            );
            if (Array.isArray(value)) history = value;
          } catch {
            history = [];
          }
          history.push({
            requestId,
            ...(providerRegistrationId ? { registrationId: providerRegistrationId } : {}),
            status: result.status,
            ...("message" in result ? { message: result.message } : {}),
            ...(result.status === "refused" && result.refusalCode
              ? { refusalCode: result.refusalCode }
              : {}),
          });
          body.setAttribute(
            "data-java-definition-result-history",
            JSON.stringify(history.slice(-8)),
          );
        }
      } else if (kind === "references") {
        recordNavigationEvidence("data-java-reference-result-status", result.status);
        recordNavigationEvidence(
          "data-java-reference-result-message",
          "message" in result ? result.message : null,
        );
        appendNavigationEvidence("data-java-reference-result-history", {
          requestId,
          status: result.status,
          ...("message" in result ? { message: result.message } : {}),
          ...(result.status === "refused" && result.refusalCode
            ? { refusalCode: result.refusalCode }
            : {}),
        });
      }
      if (
        !requestIsCurrent() ||
        (result.status !== "ready" &&
          !(
            (kind === "definition" &&
              (result.status === "unavailable" || result.status === "refused")) ||
            (kind === "references" && result.status === "refused") ||
            (kind === "typeDefinition" &&
              (result.status === "unavailable" || result.status === "refused"))
          )) ||
        result.requestId !== requestId ||
        result.kind !== kind ||
        result.documentVersion !== version ||
        result.documentPath !== filePath ||
        result.workspaceId !== navigation.context.workspaceId ||
        result.generation !== navigation.context.generation
      ) {
        if (!requestIsCurrent()) navigation.cancel(requestId);
        return null;
      }
      if (kind === "definition" && result.status === "refused") {
        const fallback =
          result.projectContextRetired ||
          result.refusalCode !== "java.context.sourceAnalysisUnqualified"
            ? undefined
            : await tryJdtDefinition(candidate, point, version, token);
        if (!requestIsCurrent()) return null;
        if (fallback?.locations) {
          onNavigationStatus?.(null);
          return fallback.locations;
        }
        else
          onNavigationStatus?.(
            fallback?.reason ? `${result.message} ${fallback.reason}` : result.message,
          );
        return null;
      }
      if (kind === "references" && result.status === "refused") {
        const fallback =
          result.projectContextRetired ||
          result.refusalCode !== "java.context.sourceAnalysisUnqualified"
            ? undefined
            : await tryJdtReferences(candidate, point, version, includeDeclaration, token);
        if (!requestIsCurrent()) return null;
        if (fallback?.locations) {
          onNavigationStatus?.(fallback.reason ?? null);
          return fallback.locations;
        }
        onNavigationStatus?.(
          fallback?.reason ? `${result.message} ${fallback.reason}` : result.message,
        );
        return null;
      }
      if (kind === "typeDefinition" && result.status !== "ready") {
        const fallback = result.status === "refused" &&
          !result.projectContextRetired &&
          result.refusalCode === "java.context.sourceAnalysisUnqualified"
          ? await tryJdtDefinition(candidate, point, version, token, kind)
          : undefined;
        if (!requestIsCurrent()) return null;
        if (fallback?.locations) {
          onNavigationStatus?.(null);
          return fallback.locations;
        }
        onNavigationStatus?.(fallback?.reason ? `${result.message} ${fallback.reason}` : result.message);
        return null;
      }
      if (
        kind === "definition" &&
        result.status === "unavailable" &&
        (result.projectContextRetired || !navigation.queryDependencyDefinition)
      ) {
        const fallback = result.projectContextRetired
          ? undefined
          : await tryJdtDefinition(candidate, point, version, token);
        if (!requestIsCurrent()) return null;
        if (fallback?.locations) {
          onNavigationStatus?.(null);
          return fallback.locations;
        }
        else
          onNavigationStatus?.(
            fallback?.reason ? `${result.message} ${fallback.reason}` : result.message,
          );
        return null;
      }
      if (
        kind === "definition" &&
        (result.status === "unavailable" ||
          (result.status === "ready" && result.locations.length === 0)) &&
        navigation.queryDependencyDefinition
      ) {
        recordNavigationEvidence("data-java-dependency-definition-result-status", "pending");
        let definition: JavaLibraryDefinition | null;
        try {
          definition = await navigation.queryDependencyDefinition(request, result);
        } catch {
          recordNavigationEvidence("data-java-dependency-definition-result-status", "error");
          definition = null;
        }
        recordNavigationEvidence(
          "data-java-dependency-definition-result-status",
          definition ? "resolved" : "unavailable",
        );
        if (
          cancelled ||
          token.isCancellationRequested ||
          !matches(candidate) ||
          candidate.getVersionId() !== version
        ) {
          navigation.cancel(requestId);
          return null;
        }
        if (!definition || definition.requestId !== requestId) {
          const fallback = await tryJdtDefinition(candidate, point, version, token);
          if (!requestIsCurrent()) return null;
          if (fallback.locations) {
            onNavigationStatus?.(null);
            return fallback.locations;
          }
          onNavigationStatus?.(
            result.status === "unavailable"
              ? (fallback.reason ? `${result.message} ${fallback.reason}` : result.message)
              : fallback.reason ?? "No Java definition was found.",
          );
          navigation.cancel(requestId);
          return null;
        }
        const uri = api.Uri.from({
          scheme: "refactorkit-java",
          authority: "dependency-source",
          path: `/${definition.title}`,
          query: new URLSearchParams({
            workspace: navigation.context.workspaceId,
            generation: String(navigation.context.generation),
            request: requestId,
            resource: definition.resourceUri,
          }).toString(),
        });
        const preview = api.editor.createModel(definition.content, "java", uri);
        libraryPreviews.set(uri.toString(), { model: preview, definition });
        batch.push(uri.toString());
        batches.push(batch);
        while (batches.length > 2) for (const previous of batches.shift()!) retire(previous);
        return [
          {
            uri,
            range: new api.Range(
              definition.range.start.line + 1,
              definition.range.start.character + 1,
              definition.range.end.line + 1,
              definition.range.end.character + 1,
            ),
          },
        ];
      }
      if (
        kind === "definition" &&
        result.status === "ready" &&
        result.locations.length === 0
      ) {
        const fallback = await tryJdtDefinition(candidate, point, version, token);
        if (!requestIsCurrent()) return null;
        if (fallback?.locations) {
          onNavigationStatus?.(null);
          return fallback.locations;
        }
        onNavigationStatus?.(fallback.reason ?? "No Java definition was found.");
        return null;
      }
      if (result.status !== "ready") return null;
      const uris = new Map<string, Monaco.Uri>();
      for (const file of result.sourceFiles) {
        const uri = api.Uri.from({
          scheme: "refactorkit-java",
          authority: "navigation",
          path: `/${file.path}`,
          query: new URLSearchParams({
            workspace: navigation.context.workspaceId,
            generation: String(navigation.context.generation),
            request: requestId,
          }).toString(),
        });
        const preview = api.editor.createModel(
          file.text,
          getMonacoLanguage("plaintext", file.path),
          uri,
        );
        const location = result.locations.find((item) => item.path === file.path)!;
        previews.set(uri.toString(), { model: preview, requestId, location });
        uris.set(file.path, uri);
        batch.push(uri.toString());
      }
      batches.push(batch);
      while (batches.length > 2)
        for (const uri of batches.shift()!) {
          retire(uri);
        }
      return result.locations.map((location) => ({
        uri: uris.get(location.path)!,
        range: new api.Range(
          location.range.start.line + 1,
          location.range.start.character + 1,
          location.range.end.line + 1,
          location.range.end.character + 1,
        ),
      }));
    } catch (error) {
      navigation.cancel(requestId);
      for (const uri of batch) {
        retire(uri);
      }
      throw error;
    } finally {
      pending.delete(requestId);
      if (kind === "definition" && providerRegistrationId)
        appendNavigationEvidence("data-java-definition-provider-history", {
          event: "settled",
          atMs: Math.round(performance.now()),
          elapsedMs: Math.round(performance.now() - requestStarted),
          registrationId: providerRegistrationId,
          requestId,
        });
      cancel.dispose();
    }
  }

  const definitionCounterAttribute = "data-java-definition-provider-call-count";
  const editorNode = editor.getDomNode();
  const recordNavigationEvidence = (name: string, value: string | null) => {
    const body = editorNode?.ownerDocument?.body;
    if (!body?.hasAttribute("data-native-java-navigation-diagnostics")) return;
    if (value === null) {
      editorNode?.removeAttribute(name);
      body.removeAttribute(name);
    } else {
      editorNode?.setAttribute(name, value);
      body.setAttribute(name, value);
    }
  };
  const appendNavigationEvidence = (name: string, entry: Record<string, unknown>) => {
    const body = editorNode?.ownerDocument?.body;
    if (!body?.hasAttribute("data-native-java-navigation-diagnostics")) return;
    let history: Array<Record<string, unknown>> = [];
    try {
      const value = JSON.parse(body.getAttribute(name) ?? "[]");
      if (Array.isArray(value)) history = value;
    } catch {
      history = [];
    }
    history.push(entry);
    recordNavigationEvidence(name, JSON.stringify(history.slice(-12)));
  };
  if (editorNode && !editorNode.hasAttribute(definitionCounterAttribute))
    editorNode.setAttribute(definitionCounterAttribute, "0");
  let definitionCalls = Number(editorNode?.getAttribute(definitionCounterAttribute) ?? 0);
  const recordDefinitionCall = (registrationId: string) => {
    definitionCalls += 1;
    editorNode?.setAttribute(definitionCounterAttribute, String(definitionCalls));
    const body = editorNode?.ownerDocument?.body;
    if (body?.hasAttribute("data-native-java-navigation-diagnostics")) {
      body.setAttribute(definitionCounterAttribute, String(definitionCalls));
      appendNavigationEvidence("data-java-definition-provider-invocations", { registrationId });
    }
  };
  const definitionRegistrationId = `java-definition-provider-${++definitionProviderSequence}`;
  appendNavigationEvidence("data-java-definition-provider-history", {
    event: "provider-registered",
    atMs: Math.round(performance.now()),
    registrationId: definitionRegistrationId,
  });
  const definition = api.languages.registerDefinitionProvider("java", {
    provideDefinition: (candidate, point, token) => {
      recordDefinitionCall(definitionRegistrationId);
      return query(candidate, point, "definition", true, token, definitionRegistrationId);
    },
  });
  const typeDefinition = (navigation.typeDefinitionAvailable || getCurrentSemantics()?.typeDefinitions)
    ? api.languages.registerTypeDefinitionProvider("java", {
        provideTypeDefinition: (candidate, point, token) =>
          query(candidate, point, "typeDefinition", true, token),
      })
    : undefined;
  const modifiedClick = editor.onMouseDown(({ event, target }) => {
    if (
      !matches(model) ||
      !event.leftButton ||
      (!event.ctrlKey && !event.metaKey) ||
      target.type !== api.editor.MouseTargetType.CONTENT_TEXT
    )
      return;

    event.preventDefault();
    event.stopPropagation();
    const cancellation = new api.CancellationTokenSource();
    void (async () => {
      try {
        const locations = await query(
          model,
          target.position,
          "definition",
          true,
          cancellation.token,
          definitionRegistrationId,
        );
        const location = locations?.[0];
        const navigation = getCurrentNavigation();
        if (!location || !navigation || !matches(model)) return;
        if (languageServiceLocations.has(location.uri.toString())) {
          await editorOpener.openCodeEditor(editor, location.uri, location.range);
          return;
        }
        const library = libraryPreviews.get(location.uri.toString());
        if (library && navigation.openDependencyDefinition) {
          await navigation.openDependencyDefinition(
            library.definition.requestId,
            library.definition.range,
          );
          return;
        }
        const preview = previews.get(location.uri.toString());
        if (preview) await navigation.openLocation(preview.requestId, preview.location);
      } finally {
        cancellation.dispose();
      }
    })().catch(() => {});
  });
  const references = api.languages.registerReferenceProvider("java", {
    provideReferences: (candidate, point, context, token) =>
      query(candidate, point, "references", context.includeDeclaration, token),
  });
  const editorOpener: Monaco.editor.ICodeEditorOpener = {
    async openCodeEditor(_source, resource, selection) {
      const navigation = getCurrentNavigation();
      if (!navigation || !matches(model)) return false;
      const languageServiceLocation = languageServiceLocations.get(resource.toString());
      if (languageServiceLocation) {
        if (!languageServiceLocation.references) languageServiceLocations.delete(resource.toString());
        const isCurrent = (afterOpen: boolean) => {
          const activeNavigation = getCurrentNavigation();
          const workspaceCurrent =
            activeNavigation?.context.workspaceId === navigation.context.workspaceId &&
            activeNavigation.context.generation === navigation.context.generation;
          if (!workspaceCurrent) return false;
          if (afterOpen)
            return (
              model.isDisposed() ||
              model.getVersionId() === languageServiceLocation.sourceVersion
            );
          const currentSemantics = getCurrentSemantics()?.context;
          return (
            !disposed &&
            matches(model) &&
            model.getVersionId() === languageServiceLocation.sourceVersion &&
            editor.getModel() === model &&
            editor.getPosition()?.lineNumber ===
              languageServiceLocation.sourcePosition.lineNumber &&
            editor.getPosition()?.column === languageServiceLocation.sourcePosition.column &&
            currentSemantics?.workspaceId ===
              languageServiceLocation.semanticContext.workspaceId &&
            currentSemantics.generation === languageServiceLocation.semanticContext.generation &&
            currentSemantics.document.path ===
              languageServiceLocation.semanticContext.document.path &&
            currentSemantics.document.uri ===
              languageServiceLocation.semanticContext.document.uri &&
            currentSemantics.document.version ===
              languageServiceLocation.semanticContext.document.version
          );
        };
        if (!isCurrent(false)) return false;
        let location = languageServiceLocation.location;
        if (languageServiceLocation.references) {
          const position = selection
            ? "startLineNumber" in selection
              ? { line: selection.startLineNumber - 1, character: selection.startColumn - 1 }
              : { line: selection.lineNumber - 1, character: selection.column - 1 }
            : location.range.start;
          const selected = languageServiceLocation.references.locations.find(
            (item) =>
              item.range.start.line === position.line &&
              item.range.start.character === position.character,
          );
          if (!selected || !navigation.readSource) return false;
          let text: string | null;
          try {
            text = await navigation.readSource(selected.path, () => isCurrent(false));
          } catch {
            return false;
          }
          if (!isCurrent(false) || text !== languageServiceLocation.references.text) return false;
          location = selected;
        }
        return getNavigateJavaDefinition?.()?.(location, isCurrent) ?? false;
      }
      const library = libraryPreviews.get(resource.toString());
      if (library && !disposed && matches(model) && navigation.openDependencyDefinition) {
        const range =
          selection && "startLineNumber" in selection
            ? {
                start: {
                  line: selection.startLineNumber - 1,
                  character: selection.startColumn - 1,
                },
                end: { line: selection.endLineNumber - 1, character: selection.endColumn - 1 },
              }
            : selection
              ? {
                  start: { line: selection.lineNumber - 1, character: selection.column - 1 },
                  end: { line: selection.lineNumber - 1, character: selection.column - 1 },
                }
              : library.definition.range;
        const name = library.definition.range;
        const atNameStart =
          range.start.line === name.start.line &&
          range.start.character === name.start.character &&
          range.end.line === range.start.line &&
          range.end.character === range.start.character;
        return navigation.openDependencyDefinition(
          library.definition.requestId,
          atNameStart ? name : range,
        );
      }
      const preview = previews.get(resource.toString());
      if (!preview || disposed || !matches(model)) return false;
      const position = selection
        ? "startLineNumber" in selection
          ? { lineNumber: selection.startLineNumber, column: selection.startColumn }
          : selection
        : {
            lineNumber: preview.location.range.start.line + 1,
            column: preview.location.range.start.character + 1,
          };
      const valid = preview.model.validatePosition(position);
      const location = {
        path: preview.location.path,
        range: {
          start: { line: valid.lineNumber - 1, character: valid.column - 1 },
          end: { line: valid.lineNumber - 1, character: valid.column - 1 },
        },
      };
      return navigation.openLocation(preview.requestId, location);
    },
  };
  const opener = api.editor.registerEditorOpener(editorOpener);
  return {
    dispose() {
      if (pending.size > 0)
        appendNavigationEvidence("data-java-definition-provider-history", {
          event: "provider-disposed-with-pending-request",
          atMs: Math.round(performance.now()),
          registrationId: definitionRegistrationId,
          requestIds: [...pending.keys()],
        });
      disposed = true;
      for (const cancel of pending.values()) cancel();
      pending.clear();
      definition.dispose();
      typeDefinition?.dispose();
      modifiedClick.dispose();
      references.dispose();
      opener.dispose();
      findReferences.dispose();
      dependencySource?.dispose();
      newEditor.dispose();
      for (const editor of editors.values()) editor.dispose();
      editors.clear();
      for (const preview of previews.values()) preview.model.dispose();
      for (const preview of libraryPreviews.values()) preview.model.dispose();
      previews.clear();
      libraryPreviews.clear();
      languageServiceLocations.clear();
      for (const preview of languageServicePreviews.values()) preview.dispose();
      languageServicePreviews.clear();
      languageServiceBatches.length = 0;
      batches.length = 0;
    },
  };
}

/** Register JDT-backed implementation navigation independently from RefactorKit definitions. */
export function registerJavaImplementationNavigation({
  api,
  model,
  filePath,
  navigation,
  getCurrentNavigation,
  getCurrentSemantics,
}: {
  api: typeof Monaco;
  model: Monaco.editor.ITextModel;
  filePath: string;
  navigation: JavaEditorNavigation;
  getCurrentNavigation(): JavaEditorNavigation | undefined;
  getCurrentSemantics(): JavaEditorSemantics | undefined;
}): Monaco.IDisposable {
  let disposed = false;
  const trace = (value: Record<string, unknown>) => {
    if (
      typeof document !== "undefined" &&
      document.body?.hasAttribute("data-native-java-navigation-diagnostics")
    )
      document.documentElement.setAttribute(
        "data-native-java-implementation-provider-trace",
        JSON.stringify(value),
      );
  };
  const locations = new Map<string, { location: JavaNavigationLocation; sourceVersion: number }>();
  const pending = new Map<string, string>();
  const matches = (candidate: Monaco.editor.ITextModel) =>
    !disposed &&
    candidate === model &&
    !model.isDisposed() &&
    getCurrentNavigation()?.context.workspaceId === navigation.context.workspaceId &&
    getCurrentNavigation()?.context.generation === navigation.context.generation;
  const implementations = api.languages.registerImplementationProvider("java", {
    async provideImplementation(candidate, point, token) {
      const current = getCurrentSemantics();
      const context = current?.context;
      const currentNavigation = getCurrentNavigation();
      const guardChecks = {
        providerActive: !disposed && candidate === model && !model.isDisposed(),
        navigationWorkspaceMatches:
          currentNavigation?.context.workspaceId === navigation.context.workspaceId,
        navigationGenerationMatches:
          currentNavigation?.context.generation === navigation.context.generation,
        semanticsAvailable: Boolean(current),
        contextAvailable: Boolean(context),
        workspaceMatches: context?.workspaceId === navigation.context.workspaceId,
        pathMatches: context?.document.path === filePath,
        uriMatches: context?.document.uri === candidate.uri.toString(),
        versionMatches: context?.document.version === candidate.getVersionId(),
        tokenActive: !token.isCancellationRequested,
      };
      trace({
        phase: "provider-called",
        guardChecks,
      });
      // Workspace navigation and Java language-service generations have separate owners.
      if (
        !matches(candidate) ||
        !current ||
        !context ||
        context.workspaceId !== navigation.context.workspaceId ||
        context.document.path !== filePath ||
        context.document.uri !== candidate.uri.toString() ||
        context.document.version !== candidate.getVersionId() ||
        token.isCancellationRequested
      )
        return null;
      const sourceVersion = candidate.getVersionId();
      const requestId = `java-implementation-${++sequence}`;
      const cancellationId = `java-implementation-cancel-${++sequence}`;
      const request: JavaSemanticRequest = {
        workspaceId: context.workspaceId,
        generation: context.generation,
        document: { ...context.document },
        position: { line: point.lineNumber - 1, character: point.column - 1 },
        requestId,
        cancellationId,
      };
      locations.clear();
      let cancelled = false;
      const cancellation = token.onCancellationRequested(() => {
        cancelled = true;
        void getCurrentSemantics()?.cancel(cancellationId);
      });
      pending.set(requestId, cancellationId);
      try {
        const response = await current.implementations(request);
        trace({
          phase: "provider-response",
          ok: response.ok,
          locationCount: response.ok ? response.result.locations.length : 0,
          errorKind: response.ok ? null : response.error.kind,
        });
        const latest = getCurrentSemantics();
        if (
          cancelled ||
          token.isCancellationRequested ||
          !matches(candidate) ||
          candidate.getVersionId() !== sourceVersion ||
          latest?.context?.workspaceId !== context.workspaceId ||
          latest.context.generation !== context.generation ||
          latest.context.document.path !== context.document.path ||
          latest.context.document.version !== sourceVersion ||
          !response.ok ||
          response.requestId !== requestId ||
          response.result.workspaceId !== context.workspaceId ||
          response.result.generation !== context.generation ||
          response.result.document.path !== filePath ||
          response.result.document.uri !== context.document.uri ||
          response.result.document.version !== sourceVersion
        )
          return null;
        return response.result.locations.map((location, index) => {
          const uri = api.Uri.from({
            scheme: "ide-java-implementation",
            authority: `${requestId}-${index}`,
            path: `/${location.path}`,
          });
          locations.set(uri.toString(), { location, sourceVersion });
          return {
            uri,
            range: new api.Range(
              location.range.start.line + 1,
              location.range.start.character + 1,
              location.range.end.line + 1,
              location.range.end.character + 1,
            ),
          };
        });
      } catch (error) {
        trace({
          phase: "provider-error",
          errorType: error instanceof Error ? error.name : typeof error,
        });
        return null;
      } finally {
        pending.delete(requestId);
        cancellation.dispose();
      }
    },
  });
  const opener = api.editor.registerEditorOpener({
    async openCodeEditor(_source, resource) {
      const target = locations.get(resource.toString());
      const isCurrent = () => {
        if (!target || model.isDisposed() || model.getVersionId() !== target.sourceVersion)
          return false;
        const activeNavigation = getCurrentNavigation();
        return (
          activeNavigation?.context.workspaceId === navigation.context.workspaceId &&
          activeNavigation.context.generation === navigation.context.generation
        );
      };
      if (!target || !isCurrent()) return false;
      return (
        getCurrentNavigation()?.navigateToImplementation?.(target.location, isCurrent) ?? false
      );
    },
  });
  return {
    dispose() {
      disposed = true;
      for (const cancellationId of pending.values())
        void getCurrentSemantics()?.cancel(cancellationId);
      pending.clear();
      implementations.dispose();
      opener.dispose();
      locations.clear();
    },
  };
}
