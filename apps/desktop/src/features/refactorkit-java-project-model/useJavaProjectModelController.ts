import type {
  RefactorKitCapabilities,
  RefactorKitCommandResult,
  RefactorKitStatus,
  WorkspaceInfo,
} from "@ide/contracts";
import type { RefactorKitPort } from "@ide/web-core/ports";
import { useCallback, useEffect, useRef, useState } from "react";

const MAX_PRESENTED_SYMBOLS = 500;
const SCAN_ERROR = "The Java project-model scan could not be completed.";
const SYMBOLS_ERROR = "The Java project-model symbols could not be loaded.";
const UNAUTHORIZED_REASON = "Authorize a desktop workspace before loading the Java project model.";
const CAPABILITY_REASON =
  "The RefactorKit engine does not advertise the Java project-model surface (scan/symbols).";
const ENGINE_ABSENT_REASON = "The RefactorKit engine is unavailable for this workspace.";

export type JavaProjectModelAvailability = "available" | "unavailable" | "error";

/** One engine symbol entry, normalized from the engine `symbols` stdout line `kind\tfqcn\tpath:line`. */
export interface JavaProjectModelSymbol {
  readonly kind: string;
  readonly qualifiedName: string;
  readonly path: string;
  readonly line: number;
}

/** A type-declaration entry (class/interface/enum/record/annotation/object) from the engine result. */
export interface JavaProjectModelClass {
  readonly name: string;
  readonly qualifiedName: string;
  readonly kind: string;
  readonly path: string;
  readonly line: number;
}

/** A package derived from the engine symbol qualified names, presented as a read-only grouping. */
export interface JavaProjectModelPackage {
  readonly name: string;
  readonly classCount: number;
  readonly symbolCount: number;
}

export interface JavaProjectModel {
  readonly packages: readonly JavaProjectModelPackage[];
  readonly classes: readonly JavaProjectModelClass[];
  readonly symbols: readonly JavaProjectModelSymbol[];
}

export interface JavaProjectModelWorkspaceContext {
  generation: number;
  workspaceId: string | null;
  isSwitching: boolean;
  isMetadataLoading: boolean;
}

export interface UseJavaProjectModelControllerDependencies {
  refactorKit: RefactorKitPort;
  /** Authoritative engine availability from the shared RefactorKit status controller. */
  status: RefactorKitStatus | null;
  /** Authoritative engine capability advertisement (operational surface includes scan/symbols). */
  capabilities: RefactorKitCapabilities | null;
  isCheckingCapabilities: boolean;
  workspaceInfo: WorkspaceInfo | null;
  workspaceGeneration: number;
  getWorkspaceContext(): JavaProjectModelWorkspaceContext;
}

export interface JavaProjectModelController {
  availability: JavaProjectModelAvailability;
  availabilityReason: string | null;
  isBusy: boolean;
  error: string | null;
  projectRoot: string | null;
  model: JavaProjectModel | null;
  /** Requests the engine scan/symbols for the current authorized workspace root. */
  refresh(): Promise<void>;
  cancel(): void;
  /** Invalidates the presented model when the workspace authority changes. */
  resetWorkspace(): void;
}

const TYPE_DECLARATION_KINDS = new Set([
  "CLASS",
  "INTERFACE",
  "ENUM",
  "RECORD",
  "ANNOTATION",
  "OBJECT",
]);

function isTypeDeclaration(kind: string): boolean {
  return TYPE_DECLARATION_KINDS.has(kind.toUpperCase());
}

function packageOf(qualifiedName: string): string {
  const lastDot = qualifiedName.lastIndexOf(".");
  if (lastDot <= 0) return "(default)";
  return qualifiedName.slice(0, lastDot);
}

function symbolName(qualifiedName: string): string {
  const lastDot = qualifiedName.lastIndexOf(".");
  return lastDot < 0 ? qualifiedName : qualifiedName.slice(lastDot + 1);
}

/**
 * The owner type entry of a member symbol (METHOD/FIELD/CONSTRUCTOR), i.e. the
 * qualified name without its trailing member segment.
 */
function memberOwner(qualifiedName: string): string {
  const lastDot = qualifiedName.lastIndexOf(".");
  return lastDot < 0 ? qualifiedName : qualifiedName.slice(0, lastDot);
}

/**
 * The read-only package grouping one engine symbol entry belongs to. PACKAGE
 * declarations are package groupings, not symbol entries: their qualified name
 * IS the package name. Type declarations sit directly under their package
 * prefix; member entries belong to the package of the class they decorate, so
 * the trailing member segment is dropped before the package prefix is derived.
 */
function packageNameOf(symbol: JavaProjectModelSymbol): string {
  if (symbol.kind.toUpperCase() === "PACKAGE") return symbol.qualifiedName;
  if (isTypeDeclaration(symbol.kind)) return packageOf(symbol.qualifiedName);
  return packageOf(memberOwner(symbol.qualifiedName));
}

/**
 * Parses one engine `symbols` stdout line `kind\tfqcn\tpath:line` into a symbol
 * entry. Malformed lines are skipped; the engine result is the only source and
 * nothing is fabricated.
 */
export function parseEngineSymbolLine(line: string): JavaProjectModelSymbol | null {
  const [kind, qualifiedName, location] = line.split("\t");
  if (!kind || !qualifiedName || !location) return null;
  const separator = location.lastIndexOf(":");
  if (separator <= 0) return null;
  const path = location.slice(0, separator);
  const lineNumber = Number.parseInt(location.slice(separator + 1), 10);
  if (!Number.isInteger(lineNumber) || lineNumber <= 0 || path.length === 0) return null;
  return { kind, qualifiedName, path, line: lineNumber };
}

/** Parses engine `symbols` stdout into symbol entries. */
export function parseEngineSymbols(stdout: string): readonly JavaProjectModelSymbol[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(parseEngineSymbolLine)
    .filter((symbol): symbol is JavaProjectModelSymbol => symbol !== null);
}

/**
 * Normalizes engine symbol entries into the presented project model
 * (packages/classes/symbols). Packages and classes are read-only groupings of
 * the engine's own symbol list; PACKAGE declarations are treated as package
 * groupings (not symbol/class entries), and member entries are grouped under
 * the package of their owner class. The model is never produced by the IDE
 * itself.
 */
export function buildProjectModel(
  symbols: readonly JavaProjectModelSymbol[],
): JavaProjectModel {
  const classes = symbols.filter((symbol) => isTypeDeclaration(symbol.kind));
  const packageMap = new Map<string, { classCount: number; symbolCount: number }>();
  for (const symbol of symbols) {
    const packageName = packageNameOf(symbol);
    const entry = packageMap.get(packageName) ?? { classCount: 0, symbolCount: 0 };
    entry.symbolCount += 1;
    if (isTypeDeclaration(symbol.kind)) entry.classCount += 1;
    packageMap.set(packageName, entry);
  }
  const packages = [...packageMap.entries()]
    .map(([name, counts]) => ({ name, ...counts }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    packages,
    classes: classes.map((symbol) => ({
      name: symbolName(symbol.qualifiedName),
      qualifiedName: symbol.qualifiedName,
      kind: symbol.kind,
      path: symbol.path,
      line: symbol.line,
    })),
    symbols: symbols.slice(0, MAX_PRESENTED_SYMBOLS),
  };
}

function engineSurfaceAdvertised(capabilities: RefactorKitCapabilities | null): boolean {
  if (!capabilities) return false;
  const engine = capabilities as RefactorKitCapabilities & {
    operationalSurface?: readonly string[];
  };
  const surface = engine.operationalSurface ?? [];
  return surface.includes("symbols") && surface.includes("scan");
}

function boundedReason(reason: string): string {
  return reason.slice(0, 180);
}

/**
 * Desktop composition owner of the Java project-model presentation. Given an
 * authorized workspace root, it requests the RefactorKit engine scan/symbols
 * (real_engine.rs run_engine_scan / run_engine_symbols), normalizes the engine
 * symbol result into packages/classes/symbols, and presents the read-only
 * project model. Honest unavailable/error is reported when the engine is absent
 * or the scan fails; no package/class/symbol list is ever fabricated. No native
 * API is imported here; native access is injected via the RefactorKitPort adapter.
 */
export function useJavaProjectModelController(
  dependencies: UseJavaProjectModelControllerDependencies,
): JavaProjectModelController {
  const dependenciesRef = useRef(dependencies);
  dependenciesRef.current = dependencies;
  const requestRef = useRef(0);
  const mountedRef = useRef(true);
  const workspaceGenerationRef = useRef(dependencies.workspaceGeneration);

  const [availability, setAvailability] = useState<JavaProjectModelAvailability>("unavailable");
  const [availabilityReason, setAvailabilityReason] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectRoot, setProjectRoot] = useState<string | null>(null);
  const [model, setModel] = useState<JavaProjectModel | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    const currentDependencies = dependenciesRef.current;
    const workspace = currentDependencies.workspaceInfo;
    const context = currentDependencies.getWorkspaceContext();
    const capabilities = currentDependencies.capabilities;
    const status = currentDependencies.status;

    setIsBusy(true);
    setError(null);
    setModel(null);
    setProjectRoot(null);

    // Authority gate: only an authorized, non-switching workspace root is eligible.
    if (
      !workspace ||
      context.isSwitching ||
      context.isMetadataLoading ||
      context.workspaceId !== workspace.id ||
      context.generation !== currentDependencies.workspaceGeneration
    ) {
      if (mountedRef.current && requestRef.current === requestId) {
        setAvailability("unavailable");
        setAvailabilityReason(boundedReason(!workspace ? UNAUTHORIZED_REASON : CAPABILITY_REASON));
        setIsBusy(false);
      }
      return;
    }

    // Engine presence + capability-before-offer: the engine must be available
    // and advertise the scan/symbols surface before any native command.
    if (!status?.available || !engineSurfaceAdvertised(capabilities)) {
      if (mountedRef.current && requestRef.current === requestId) {
        setAvailability("unavailable");
        setAvailabilityReason(
          boundedReason(
            !status?.available
              ? ENGINE_ABSENT_REASON
              : currentDependencies.isCheckingCapabilities
                ? "RefactorKit capability discovery is still loading."
                : CAPABILITY_REASON,
          ),
        );
        setIsBusy(false);
      }
      return;
    }

    let scanResult: RefactorKitCommandResult;
    let symbolsResult: RefactorKitCommandResult;
    try {
      // extract -> delegate -> response: the controller delegates the exact
      // workspace root scan/symbols to the owned RefactorKit engine capability.
      scanResult = await currentDependencies.refactorKit.scan();
      symbolsResult = await currentDependencies.refactorKit.symbols();
    } catch {
      if (mountedRef.current && requestRef.current === requestId) {
        setAvailability("error");
        setAvailabilityReason(null);
        setError(SCAN_ERROR);
        setIsBusy(false);
      }
      return;
    }

    if (!mountedRef.current || requestRef.current !== requestId) return;

    // Honest failure: a failed engine scan is reported as an error and never
    // fabricates a model or a fallback textual rewrite.
    if (!scanResult.success || !symbolsResult.success) {
      setAvailability("error");
      setAvailabilityReason(null);
      setError(!scanResult.success ? SCAN_ERROR : SYMBOLS_ERROR);
      setIsBusy(false);
      return;
    }

    const symbols = parseEngineSymbols(symbolsResult.stdout);
    setProjectRoot(workspace.rootPath);
    setModel(buildProjectModel(symbols));
    setAvailability("available");
    setAvailabilityReason(null);
    setIsBusy(false);
  }, []);

  const cancel = useCallback((): void => {
    requestRef.current += 1;
    setIsBusy(false);
    setError(null);
  }, []);

  const resetWorkspace = useCallback((): void => {
    requestRef.current += 1;
    setIsBusy(false);
    setError(null);
    setModel(null);
    setProjectRoot(null);
    setAvailability("unavailable");
    setAvailabilityReason(UNAUTHORIZED_REASON);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
    };
  }, []);

  useEffect(() => {
    const currentDependencies = dependenciesRef.current;
    const context = currentDependencies.getWorkspaceContext();
    const previousGeneration = workspaceGenerationRef.current;
    workspaceGenerationRef.current = currentDependencies.workspaceGeneration;
    if (
      currentDependencies.workspaceGeneration !== previousGeneration ||
      context.generation !== previousGeneration
    ) {
      // Workspace authority changed: synchronously revoke the presented project
      // model so no stale model survives a workspace switch. Availability
      // returns to honest unavailable until the user refreshes the new root.
      resetWorkspace();
    }
  }, [dependencies.workspaceGeneration, resetWorkspace]);

  return {
    availability,
    availabilityReason,
    isBusy,
    error,
    projectRoot,
    model,
    refresh,
    cancel,
    resetWorkspace,
  };
}
