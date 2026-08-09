import type {
  PiWorkspaceAgentAccessories,
  PiWorkspaceAgentAttachment,
  PiWorkspaceAgentDetachedBinding,
  PiWorkspaceAgentOutputEvent,
  PiWorkspaceAgentSessionSnapshot,
  WorkspaceInfo,
} from "@ide/contracts";
import type { PiWorkspaceAgentPort } from "@ide/web-core/ports";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface PiTerminalFeedReset {
  readonly kind: "reset";
  readonly workspaceId: string;
  readonly processGeneration: number;
  readonly sequence: number;
  readonly data: Uint8Array;
}

export interface PiTerminalFeedData {
  readonly kind: "data";
  readonly workspaceId: string;
  readonly processGeneration: number;
  readonly sequence: number;
  readonly data: Uint8Array;
}

export type PiTerminalFeedEvent = PiTerminalFeedReset | PiTerminalFeedData;
export type PiTerminalFeedListener = (event: PiTerminalFeedEvent) => void;

/**
 * Renderer-local byte fan-out for xterm. The authoritative bounded transcript
 * remains in the Rust PTY manager; this object only feeds currently mounted views.
 */
export class PiTerminalFeed {
  private listeners = new Set<PiTerminalFeedListener>();
  private current: PiTerminalFeedReset | null = null;

  reset(event: Omit<PiTerminalFeedReset, "kind">): void {
    this.current = { kind: "reset", ...event };
    for (const listener of this.listeners) listener(this.current);
  }

  append(event: Omit<PiTerminalFeedData, "kind">): void {
    if (
      !this.current ||
      event.workspaceId !== this.current.workspaceId ||
      event.processGeneration !== this.current.processGeneration ||
      event.sequence <= this.current.sequence
    ) {
      return;
    }
    this.current = { ...this.current, sequence: event.sequence };
    const next: PiTerminalFeedData = { kind: "data", ...event };
    for (const listener of this.listeners) listener(next);
  }

  subscribe(listener: PiTerminalFeedListener): () => void {
    this.listeners.add(listener);
    if (this.current) listener(this.current);
    return () => this.listeners.delete(listener);
  }
}

export interface UsePiWorkspaceAgentControllerDependencies {
  port: PiWorkspaceAgentPort;
  workspace: WorkspaceInfo | null;
  viewKind: "docked" | "detached";
}

export interface PiWorkspaceAgentController {
  workspace: WorkspaceInfo | null;
  attachment: PiWorkspaceAgentAttachment | null;
  session: PiWorkspaceAgentSessionSnapshot | null;
  accessories: PiWorkspaceAgentAccessories | null;
  terminalFeed: PiTerminalFeed;
  isAttaching: boolean;
  isAccessoryLoading: boolean;
  error: string | null;
  accessoryError: string | null;
  viewId: string;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  refresh(): Promise<void>;
  refreshAccessories(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  openDetached(): Promise<PiWorkspaceAgentDetachedBinding | null>;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unexpected Pi Agent error";
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function createViewId(kind: "docked" | "detached"): string {
  // The desktop composition has one main renderer and one fixed detached
  // renderer. Stable ids make a renderer crash/reload idempotent in the
  // backend attachment set without affecting process lifetime.
  return kind === "docked" ? "docked:main" : "detached:pi-agent";
}

function initialSize(kind: "docked" | "detached"): { cols: number; rows: number } {
  return kind === "detached" ? { cols: 120, rows: 40 } : { cols: 40, rows: 30 };
}

/** Owns one renderer attachment while the backend retains process lifetime. */
export function usePiWorkspaceAgentController({
  port,
  workspace,
  viewKind,
}: UsePiWorkspaceAgentControllerDependencies): PiWorkspaceAgentController {
  const terminalFeed = useMemo(() => new PiTerminalFeed(), []);
  const viewIdRef = useRef(createViewId(viewKind));
  const terminalSizeRef = useRef(initialSize(viewKind));
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const feedGenerationRef = useRef(-1);
  const feedSequenceRef = useRef(-1);
  const attachmentRequestRef = useRef(0);
  const accessoryRequestRef = useRef(0);
  const currentWorkspaceIdRef = useRef<string | null>(workspace?.id ?? null);
  currentWorkspaceIdRef.current = workspace?.id ?? null;

  const [attachment, setAttachment] = useState<PiWorkspaceAgentAttachment | null>(null);
  const [accessories, setAccessories] = useState<PiWorkspaceAgentAccessories | null>(null);
  const [isAttaching, setIsAttaching] = useState(Boolean(workspace));
  const [isAccessoryLoading, setIsAccessoryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accessoryError, setAccessoryError] = useState<string | null>(null);

  const applyAttachment = useCallback(
    (next: PiWorkspaceAgentAttachment): void => {
      if (currentWorkspaceIdRef.current !== next.session.workspaceId) return;
      setAttachment(next);
      feedGenerationRef.current = next.session.processGeneration;
      feedSequenceRef.current = next.transcriptSequence;
      terminalFeed.reset({
        workspaceId: next.session.workspaceId,
        processGeneration: next.session.processGeneration,
        sequence: next.transcriptSequence,
        data: decodeBase64(next.transcriptBase64),
      });
    },
    [terminalFeed],
  );

  const refreshAccessories = useCallback(async (): Promise<void> => {
    if (!workspace) return;
    const requestId = accessoryRequestRef.current + 1;
    accessoryRequestRef.current = requestId;
    setIsAccessoryLoading(true);
    setAccessoryError(null);
    try {
      const next = await port.accessories(workspace.id);
      if (
        accessoryRequestRef.current === requestId &&
        currentWorkspaceIdRef.current === next.workspaceId
      ) {
        setAccessories(next);
      }
    } catch (accessoryFailure) {
      if (
        accessoryRequestRef.current === requestId &&
        currentWorkspaceIdRef.current === workspace.id
      ) {
        setAccessoryError(errorMessage(accessoryFailure));
      }
    } finally {
      if (accessoryRequestRef.current === requestId) setIsAccessoryLoading(false);
    }
  }, [port, workspace]);

  const refresh = useCallback(async (): Promise<void> => {
    if (!workspace) return;
    const next = await port.snapshot(workspace.id);
    if (currentWorkspaceIdRef.current === workspace.id) applyAttachment(next);
  }, [applyAttachment, port, workspace]);

  useEffect(() => {
    const requestId = attachmentRequestRef.current + 1;
    attachmentRequestRef.current = requestId;
    accessoryRequestRef.current += 1;
    setAttachment(null);
    setAccessories(null);
    setError(null);
    setAccessoryError(null);
    setIsAttaching(Boolean(workspace));
    if (!workspace) return undefined;

    let disposed = false;
    let attached = false;
    let outputUnsubscribe: (() => void) | undefined;
    let statusUnsubscribe: (() => void) | undefined;
    const pendingOutput: PiWorkspaceAgentOutputEvent[] = [];
    feedGenerationRef.current = -1;
    feedSequenceRef.current = -1;

    const setup = async (): Promise<void> => {
      try {
        [outputUnsubscribe, statusUnsubscribe] = await Promise.all([
          port.subscribeOutput((event) => {
            if (event.workspaceId !== workspace.id || disposed) return;
            if (feedGenerationRef.current < 0) {
              pendingOutput.push(event);
              if (pendingOutput.length > 1000) pendingOutput.shift();
              return;
            }
            if (
              event.processGeneration !== feedGenerationRef.current ||
              event.sequence <= feedSequenceRef.current
            ) {
              return;
            }
            feedSequenceRef.current = event.sequence;
            terminalFeed.append({
              workspaceId: event.workspaceId,
              processGeneration: event.processGeneration,
              sequence: event.sequence,
              data: decodeBase64(event.dataBase64),
            });
          }),
          port.subscribeStatus((event) => {
            if (disposed || event.session.workspaceId !== workspace.id) return;
            setAttachment((current) =>
              current
                ? {
                    ...current,
                    session: event.session,
                    sessions: current.sessions.map((session) =>
                      session.workspaceId === event.session.workspaceId ? event.session : session,
                    ),
                  }
                : current,
            );
            void port
              .snapshot(workspace.id)
              .then((next) => {
                if (!disposed && currentWorkspaceIdRef.current === workspace.id) {
                  setAttachment(next);
                }
              })
              .catch(() => undefined);
          }),
        ]);
        if (disposed) return;

        const size = terminalSizeRef.current;
        const next = await port.attach({
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          viewId: viewIdRef.current,
          cols: size.cols,
          rows: size.rows,
        });
        attached = true;
        if (disposed || attachmentRequestRef.current !== requestId) {
          await port.detach({ workspaceId: workspace.id, viewId: viewIdRef.current });
          return;
        }

        applyAttachment(next);
        for (const event of pendingOutput
          .filter(
            (candidate) =>
              candidate.processGeneration === feedGenerationRef.current &&
              candidate.sequence > feedSequenceRef.current,
          )
          .sort((left, right) => left.sequence - right.sequence)) {
          feedSequenceRef.current = event.sequence;
          terminalFeed.append({
            workspaceId: event.workspaceId,
            processGeneration: event.processGeneration,
            sequence: event.sequence,
            data: decodeBase64(event.dataBase64),
          });
        }
        setIsAttaching(false);
        void refreshAccessories();
      } catch (attachFailure) {
        if (!disposed && attachmentRequestRef.current === requestId) {
          setError(errorMessage(attachFailure));
          setIsAttaching(false);
        }
      }
    };

    void setup();
    return () => {
      disposed = true;
      outputUnsubscribe?.();
      statusUnsubscribe?.();
      if (attached) {
        void port
          .detach({ workspaceId: workspace.id, viewId: viewIdRef.current })
          .catch(() => undefined);
      }
    };
  }, [applyAttachment, port, refreshAccessories, terminalFeed, workspace]);

  const write = useCallback(
    (data: string): void => {
      if (!workspace || !data) return;
      const bytes = new TextEncoder().encode(data);
      writeQueueRef.current = writeQueueRef.current
        .then(() => port.write(workspace.id, bytes))
        .catch((writeFailure) => {
          if (currentWorkspaceIdRef.current === workspace.id) {
            setError(errorMessage(writeFailure));
          }
        });
    },
    [port, workspace],
  );

  const resize = useCallback(
    (cols: number, rows: number): void => {
      terminalSizeRef.current = { cols, rows };
      if (!workspace) return;
      void port.resize({ workspaceId: workspace.id, cols, rows }).catch((resizeFailure) => {
        if (currentWorkspaceIdRef.current === workspace.id) {
          setError(errorMessage(resizeFailure));
        }
      });
    },
    [port, workspace],
  );

  const start = useCallback(async (): Promise<void> => {
    if (!workspace) return;
    setError(null);
    const size = terminalSizeRef.current;
    try {
      applyAttachment(await port.start(workspace.id, size.cols, size.rows));
      void refreshAccessories();
    } catch (startFailure) {
      setError(errorMessage(startFailure));
    }
  }, [applyAttachment, port, refreshAccessories, workspace]);

  const stop = useCallback(async (): Promise<void> => {
    if (!workspace) return;
    setError(null);
    try {
      applyAttachment(await port.stop(workspace.id, true));
    } catch (stopFailure) {
      setError(errorMessage(stopFailure));
    }
  }, [applyAttachment, port, workspace]);

  const openDetached = useCallback(async (): Promise<PiWorkspaceAgentDetachedBinding | null> => {
    if (!workspace) return null;
    setError(null);
    try {
      const binding = await port.openDetached(workspace.id);
      if (binding.workspaceId !== workspace.id) {
        setError(
          `The existing detached Agent remains pinned to ${binding.workspaceName}; close it before detaching ${workspace.name}.`,
        );
      }
      return binding;
    } catch (detachFailure) {
      setError(errorMessage(detachFailure));
      return null;
    }
  }, [port, workspace]);

  return {
    workspace,
    attachment,
    session: attachment?.session ?? null,
    accessories,
    terminalFeed,
    isAttaching,
    isAccessoryLoading,
    error,
    accessoryError,
    viewId: viewIdRef.current,
    write,
    resize,
    refresh,
    refreshAccessories,
    start,
    stop,
    openDetached,
  };
}
