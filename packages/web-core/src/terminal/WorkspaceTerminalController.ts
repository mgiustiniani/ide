import type {
  RawTerminalFeed,
  RawTerminalFeedEvent,
  WorkspaceTerminalCapabilities,
  WorkspaceTerminalContext,
  WorkspaceTerminalSession,
  WorkspaceTerminalSnapshot,
} from "@ide/contracts";
import type { WorkspaceTerminalPort } from "../ports/workspace-terminal-port";
const RETAINED_BYTES = 1024 * 1024;
const INPUT_BYTES = 64 * 1024;
function encode(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}
function decode(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}
class Feed implements RawTerminalFeed {
  private bytes = new Uint8Array();
  private listeners = new Set<(event: RawTerminalFeedEvent) => void>();
  subscribe(listener: (event: RawTerminalFeedEvent) => void) {
    this.listeners.add(listener);
    listener({ kind: "reset", data: this.bytes.slice() });
    return () => {
      this.listeners.delete(listener);
    };
  }
  clear() {
    this.bytes = new Uint8Array();
    this.send({ kind: "reset", data: this.bytes });
  }
  append(data: Uint8Array, reset: boolean) {
    if (reset) this.clear();
    if (!data.length) return;
    const merged = new Uint8Array(Math.min(RETAINED_BYTES, this.bytes.length + data.length));
    const old = Math.max(0, merged.length - data.length);
    merged.set(this.bytes.subarray(this.bytes.length - old));
    merged.set(data.subarray(Math.max(0, data.length - merged.length)), old);
    this.bytes = merged;
    this.send({ kind: "data", data });
  }
  private send(event: RawTerminalFeedEvent) {
    for (const listener of this.listeners) listener(event);
  }
}
interface RecordState {
  snapshot: WorkspaceTerminalSnapshot;
  feed: Feed;
  cursor: number;
  revision: number;
  queue: Uint8Array[];
  queued: number;
  writing: boolean;
  resizing: boolean;
  desiredSize: { cols: number; rows: number } | null;
  busy: boolean;
}
export interface WorkspaceTerminalView {
  capabilities: WorkspaceTerminalCapabilities | null;
  trusted: boolean;
  pending: boolean;
  error: string | null;
  sessions: readonly {
    snapshot: WorkspaceTerminalSnapshot;
    feed: RawTerminalFeed;
    busy: boolean;
  }[];
  activeSessionId: string | null;
}
/** Owns renderer transport only. Native code owns PTYs and process cleanup. */
export class WorkspaceTerminalController {
  private context: WorkspaceTerminalContext | null = null;
  private epoch = 0;
  private readonly clientId = crypto.randomUUID();
  private records = new Map<string, RecordState>();
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private polling = false;
  private view: WorkspaceTerminalView = {
    capabilities: null,
    trusted: false,
    pending: false,
    error: null,
    sessions: [],
    activeSessionId: null,
  };
  constructor(private readonly port: WorkspaceTerminalPort) {}
  getState = () => this.view;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<WorkspaceTerminalView> = {}) {
    this.view = {
      ...this.view,
      ...patch,
      sessions: [...this.records.values()].map(({ snapshot, feed, busy }) => ({
        snapshot,
        feed,
        busy,
      })),
    };
    for (const listener of this.listeners) listener();
  }
  private current(epoch: number) {
    return this.epoch === epoch && this.context !== null;
  }
  private request(record: RecordState): WorkspaceTerminalSession {
    return {
      workspaceId: record.snapshot.workspaceId,
      generation: record.snapshot.generation,
      clientId: record.snapshot.clientId,
      sessionId: record.snapshot.sessionId,
      cursor: record.cursor,
    };
  }
  setContext(input: Omit<WorkspaceTerminalContext, "clientId"> | null) {
    const context = input ? { ...input, clientId: this.clientId } : null;
    if (
      this.context?.workspaceId === context?.workspaceId &&
      this.context?.generation === context?.generation
    )
      return;
    const previous = [...this.records.values()];
    this.context = context;
    const epoch = ++this.epoch;
    clearTimeout(this.timer);
    this.polling = false;
    this.records.clear();
    this.publish({
      capabilities: null,
      trusted: false,
      pending: !!context,
      error: null,
      activeSessionId: null,
    });
    // Workspace switch and native exit also revoke process authority. These are best-effort
    // renderer detach requests; an old context may already have been revoked natively.
    for (const record of previous)
      void this.port.close(this.request(record)).catch(() => undefined);
    if (!context) return;
    void this.port
      .capabilities(context)
      .then((capabilities) => {
        if (this.current(epoch)) this.publish({ capabilities, pending: false, error: null });
      })
      .catch((error: unknown) => {
        if (this.current(epoch))
          this.publish({
            pending: false,
            capabilities: {
              ...context,
              available: false,
              defaultShell: null,
              reason: message(error),
            },
            error: null,
          });
      });
  }
  trust(trusted: boolean) {
    this.publish({ trusted });
  }
  select(id: string) {
    if (this.records.has(id)) this.publish({ activeSessionId: id });
  }
  clear() {
    const record = this.active();
    record?.feed.clear();
  }
  private active() {
    return this.view.activeSessionId ? this.records.get(this.view.activeSessionId) : undefined;
  }
  async start(cwd: string, shell?: string) {
    const context = this.context;
    const epoch = this.epoch;
    if (!context || this.view.pending || !this.view.capabilities?.available || !this.view.trusted) {
      this.publish({
        error: "Trust the workspace and wait for the terminal provider before starting a shell.",
      });
      return;
    }
    this.publish({ pending: true, error: null });
    try {
      const snapshot = await this.port.start({
        ...context,
        trusted: true,
        cwd,
        shell,
        cols: 80,
        rows: 24,
      });
      if (!this.current(epoch)) {
        void this.port
          .close({ ...context, sessionId: snapshot.sessionId, cursor: 0 })
          .catch(() => undefined);
        return;
      }
      const record: RecordState = {
        snapshot,
        feed: new Feed(),
        cursor: 0,
        revision: 0,
        queue: [],
        queued: 0,
        writing: false,
        resizing: false,
        desiredSize: null,
        busy: false,
      };
      this.accept(record, snapshot);
      this.records.set(snapshot.sessionId, record);
      this.publish({ pending: false, activeSessionId: snapshot.sessionId });
      this.schedule();
    } catch (error) {
      if (this.current(epoch)) this.publish({ pending: false, error: message(error) });
    }
  }
  private accept(record: RecordState, snapshot: WorkspaceTerminalSnapshot) {
    if (
      (!snapshot.reset && snapshot.firstCursor !== record.cursor) ||
      snapshot.nextCursor < record.cursor
    )
      throw new Error("Terminal output arrived out of order.");
    record.feed.append(decode(snapshot.dataBase64), snapshot.reset);
    record.cursor = snapshot.nextCursor;
    record.snapshot = snapshot;
  }
  private schedule() {
    clearTimeout(this.timer);
    if (this.records.size)
      this.timer = setTimeout(() => {
        void this.poll();
      }, 100);
  }
  private async poll() {
    if (this.polling) return;
    this.polling = true;
    const epoch = this.epoch;
    await Promise.all(
      [...this.records.values()].map(async (record) => {
        if (
          record.busy ||
          (record.snapshot.state !== "running" && record.cursor >= record.snapshot.endCursor)
        )
          return;
        const revision = record.revision;
        const cursor = record.cursor;
        try {
          const snapshot = await this.port.read(this.request(record));
          if (
            !this.current(epoch) ||
            record.revision !== revision ||
            record.cursor !== cursor ||
            this.records.get(snapshot.sessionId) !== record
          )
            return;
          const changed =
            snapshot.nextCursor !== cursor ||
            snapshot.state !== record.snapshot.state ||
            snapshot.error !== record.snapshot.error;
          this.accept(record, snapshot);
          if (changed) this.publish({ error: snapshot.error });
        } catch (error) {
          if (this.current(epoch) && record.revision === revision)
            this.publish({ error: message(error) });
        }
      }),
    );
    if (this.current(epoch)) {
      this.polling = false;
      this.schedule();
    }
  }
  input(data: string) {
    const record = this.active();
    if (!record || record.busy || record.snapshot.state !== "running") return;
    const bytes = new TextEncoder().encode(data);
    if (!bytes.length) return;
    if (record.queued + bytes.length > INPUT_BYTES) {
      this.publish({ error: "Terminal input is busy. Paste at most 64 KiB at a time." });
      return;
    }
    record.queue.push(bytes);
    record.queued += bytes.length;
    void this.flush(record);
  }
  private async flush(record: RecordState) {
    if (record.writing) return;
    record.writing = true;
    const epoch = this.epoch;
    const revision = record.revision;
    try {
      while (record.queue.length && this.current(epoch) && record.revision === revision) {
        const bytes = record.queue[0];
        const chunk = bytes.subarray(0, 4096);
        const result = await this.port.write({
          ...this.request(record),
          dataBase64: encode(chunk),
        });
        if (!this.current(epoch) || record.revision !== revision) return;
        if (
          !Number.isInteger(result.acceptedBytes) ||
          result.acceptedBytes < 0 ||
          result.acceptedBytes > chunk.length
        )
          throw new Error("Invalid terminal input acknowledgement.");
        if (result.acceptedBytes === 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, 20));
          continue;
        }
        record.queued -= result.acceptedBytes;
        if (result.acceptedBytes === bytes.length) record.queue.shift();
        else record.queue[0] = bytes.subarray(result.acceptedBytes);
      }
    } catch (error) {
      if (this.current(epoch) && record.revision === revision) {
        record.queue = [];
        record.queued = 0;
        this.publish({ error: message(error) });
      }
    } finally {
      record.writing = false;
    }
  }
  async resize(cols: number, rows: number) {
    const record = this.active();
    const epoch = this.epoch;
    if (!record || record.busy || record.snapshot.state !== "running") return;
    if (!record.resizing && record.snapshot.cols === cols && record.snapshot.rows === rows) return;
    record.desiredSize = { cols, rows };
    if (record.resizing) return;
    record.resizing = true;
    const revision = record.revision;
    try {
      while (record.desiredSize && this.current(epoch) && record.revision === revision) {
        const desired = record.desiredSize;
        record.desiredSize = null;
        const snapshot = await this.port.resize({ ...this.request(record), ...desired });
        if (!this.current(epoch) || record.revision !== revision) return;
        record.snapshot = { ...record.snapshot, cols: snapshot.cols, rows: snapshot.rows };
        this.publish();
      }
    } catch (error) {
      if (this.current(epoch) && record.revision === revision)
        this.publish({ error: message(error) });
    } finally {
      record.resizing = false;
    }
  }
  async stop(close = false) {
    const record = this.active();
    const epoch = this.epoch;
    if (!record || record.busy) return;
    ++record.revision;
    record.queue = [];
    record.queued = 0;
    record.busy = true;
    this.publish({ error: null });
    try {
      if (close) {
        await this.port.close(this.request(record));
        if (!this.current(epoch)) return;
        this.records.delete(record.snapshot.sessionId);
        this.publish({ activeSessionId: this.records.keys().next().value ?? null });
      } else {
        const snapshot = await this.port.stop(this.request(record));
        if (!this.current(epoch)) return;
        // Output remains owned by the serialized poll; mutation snapshots never replay bytes.
        record.snapshot = {
          ...snapshot,
          cursor: record.cursor,
          nextCursor: record.cursor,
          dataBase64: "",
        };
        record.busy = false;
        this.publish({ error: snapshot.error });
      }
    } catch (error) {
      if (this.current(epoch)) {
        record.busy = false;
        this.publish({ error: message(error) });
      }
    }
    this.schedule();
  }
  dispose() {
    this.setContext(null);
  }
}
function message(error: unknown) {
  return error instanceof Error ? error.message : "The terminal operation failed.";
}
