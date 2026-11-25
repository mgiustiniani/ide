import { useEffect, useRef, useState } from "react";
import type { JavaApplicationInputRequest, JavaExecutionSnapshot } from "@ide/contracts";
import type { JavaExecutionPort } from "@ide/web-core/ports";

const LIMIT = 64 * 1024;
type Options = {
  port: JavaExecutionPort;
  workspaceId: string | null;
  generation: number;
  enabled: boolean;
  trusted: boolean;
  snapshot: JavaExecutionSnapshot | null;
};
type Queue = { bytes: Uint8Array | null; offset: number; request?: JavaApplicationInputRequest };

/** Input drafts and unacknowledged bytes live only in this captured session's memory. */
export function useJavaApplicationInput(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const { port, workspaceId, generation, trusted, enabled, snapshot } = options;
  const key = JSON.stringify([workspaceId, generation, snapshot?.sessionId]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingBytes, setPendingBytes] = useState(0);
  const [hasQueue, setHasQueue] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [eof, setEof] = useState(false);
  const [accepted, setAccepted] = useState(0);
  const queue = useRef<Queue | null>(null);
  const sequence = useRef<number | null>(null);
  const active = enabled && trusted && !!workspaceId && snapshot?.workspaceId === workspaceId &&
    snapshot.generation === generation && ["starting", "running"].includes(snapshot.state);
  const lifecycle = useRef({ key, port, active });
  if (lifecycle.current.key !== key || lifecycle.current.port !== port || lifecycle.current.active !== active)
    lifecycle.current = { key, port, active };

  useEffect(() => {
    queue.current = null;
    sequence.current = null;
    busyRef.current = false;
    setBusy(false);
    setDraft("");
    setError(null);
    setPendingBytes(0);
    setHasQueue(false);
    setUncertain(false);
    setEof(false);
    setAccepted(0);
  }, [key, port, active]);

  const open = active && snapshot?.applicationInput?.state === "open" && !eof &&
    typeof port.sendApplicationInput === "function";

  async function drain() {
    const owner = lifecycle.current;
    const captured = latest.current;
    const session = captured.snapshot;
    const pending = queue.current;
    const send = captured.port.sendApplicationInput?.bind(captured.port);
    if (!open || !session || !pending || !send || busyRef.current || uncertain) return;
    const current = () => {
      const value = latest.current;
      return lifecycle.current === owner && value.port === captured.port && value.workspaceId === captured.workspaceId &&
        value.generation === captured.generation && value.trusted && value.enabled &&
        value.snapshot?.sessionId === session.sessionId &&
        ["starting", "running"].includes(value.snapshot.state) && queue.current === pending;
    };
    busyRef.current = true;
    setBusy(true);
    setError(null);
    let blocked = 0;
    try {
      while (current()) {
        if (!pending.request) {
          const bytes = pending.bytes?.subarray(pending.offset, pending.offset + 4096);
          const dataBase64 = bytes ? btoa(String.fromCharCode(...bytes)) : null;
          pending.request = { workspaceId: session.workspaceId, generation: session.generation,
            sessionId: session.sessionId, sequence: sequence.current ?? session.applicationInput!.nextSequence, dataBase64 };
        }
        const request = pending.request;
        let result;
        try {
          result = await send(request);
        } catch {
          // A lost acknowledgement retries the exact sequence and bytes, once.
          if (!current()) return;
          result = await send(request);
        }
        if (!current()) return;
        const length = pending.bytes ? Math.min(4096, pending.bytes.length - pending.offset) : 0;
        if (result.workspaceId !== request.workspaceId || result.generation !== request.generation ||
            result.sessionId !== request.sessionId || result.sequence !== request.sequence ||
            !Number.isSafeInteger(result.acceptedBytes) || result.acceptedBytes < 0 || result.acceptedBytes > length ||
            result.input?.nextSequence !== request.sequence + 1 ||
            !Number.isSafeInteger(result.input.acceptedBytes) || result.input.acceptedBytes < result.acceptedBytes ||
            !["open", "closed"].includes(result.input.state) ||
            (pending.bytes === null && result.input.state !== "closed")) {
          setUncertain(true);
          throw new Error("Cannot confirm input delivery. Stop or restart this application before sending more input.");
        }
        sequence.current = request.sequence + 1;
        pending.request = undefined;
        pending.offset += result.acceptedBytes;
        setAccepted(result.input.acceptedBytes);
        setPendingBytes(pending.bytes ? pending.bytes.length - pending.offset : 0);
        if (pending.bytes === null || pending.offset === pending.bytes.length) {
          if (pending.bytes === null) setEof(true);
          queue.current = null;
          setHasQueue(false);
          setDraft("");
          return;
        }
        if (result.input.state !== "open") throw new Error("The application closed its input connection.");
        if (result.acceptedBytes === 0) {
          if (++blocked >= 20) throw new Error("Input is waiting for the application. Resume to send the remaining bytes.");
          await new Promise((resolve) => setTimeout(resolve, 50));
        } else blocked = 0;
      }
    } catch (failure) {
      if (current()) setError(failure instanceof Error ? failure.message : "Input delivery is pending. Resume to retry the same chunk.");
    } finally {
      // A completed queue is cleared before finally; owner checks still prevent old responses
      // from changing the next session's controls.
      const value = latest.current;
      if (lifecycle.current === owner && value.port === captured.port && value.workspaceId === captured.workspaceId &&
          value.generation === captured.generation && value.snapshot?.sessionId === session.sessionId &&
          value.trusted && value.enabled) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }

  function sendLine() {
    if (!open || hasQueue || busyRef.current) return;
    const bytes = new TextEncoder().encode(`${draft}\n`);
    if (bytes.length > LIMIT) { setError("Application input is limited to 64 KiB per submission."); return; }
    queue.current = { bytes, offset: 0 };
    setHasQueue(true);
    setPendingBytes(bytes.length);
    void drain();
  }
  function close() {
    if (!open || hasQueue || busyRef.current) return;
    queue.current = { bytes: null, offset: 0 };
    setHasQueue(true);
    void drain();
  }

  return { draft, setDraft, sendLine, close, resume: () => void drain(), busy, error,
    hasQueue, pendingBytes, uncertain, open, eof,
    acceptedBytes: Math.max(accepted, snapshot?.applicationInput?.acceptedBytes ?? 0),
    state: eof ? "closed" : snapshot?.applicationInput?.state,
    reason: snapshot?.applicationInput?.reason };
}
