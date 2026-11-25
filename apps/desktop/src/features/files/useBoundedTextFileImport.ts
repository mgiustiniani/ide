import { useCallback, useEffect, useRef, useState } from "react";

export interface TextFileImportPolicy {
  maximumBytes: number;
  tooLarge: string;
  readFailure: string;
  invalidEncoding: string;
}
interface Props {
  policy: TextFileImportPolicy;
  workspaceId: string | null;
  generation: number;
  enabled: boolean;
  onLoaded(source: string): void;
}
interface State { owner: string; pending: boolean; error: string | null; fileName: string | null }
const empty = (owner: string): State => ({ owner, pending: false, error: null, fileName: null });

/** User-selected data only: reading never sends a request or updates an editor save baseline. */
export function useBoundedTextFileImport(props: Props) {
  const { workspaceId, generation, enabled, policy } = props;
  const owner = JSON.stringify([workspaceId, generation, policy]);
  const latest = useRef(props);
  latest.current = props;
  const alive = useRef(false);
  const reader = useRef<FileReader | null>(null);
  const sequence = useRef(0);
  const [state, setState] = useState(() => empty(owner));
  const abort = useCallback(() => {
    sequence.current++;
    const previous = reader.current;
    reader.current = null;
    previous?.abort();
  }, []);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; abort(); };
  }, [abort]);
  useEffect(() => {
    abort();
    setState(empty(owner));
    return abort;
  }, [owner, enabled, policy, abort]);
  const scopeIsCurrent = useCallback(() => alive.current &&
    latest.current.workspaceId === workspaceId && latest.current.generation === generation && latest.current.policy === policy,
  [workspaceId, generation, policy]);
  const cancel = useCallback(() => {
    if (!scopeIsCurrent()) return;
    abort();
    setState(empty(owner));
  }, [abort, owner, scopeIsCurrent]);
  const importFile = useCallback((file: File) => {
    if (!scopeIsCurrent() || !workspaceId || !latest.current.enabled) return;
    abort();
    if (file.size > policy.maximumBytes) {
      setState({ ...empty(owner), error: policy.tooLarge });
      return;
    }
    const request = sequence.current;
    const isCurrent = () => scopeIsCurrent() && latest.current.enabled && request === sequence.current;
    const failed = (message: string) => {
      if (isCurrent()) {
        reader.current = null;
        setState({ ...empty(owner), error: message });
      }
    };
    setState({ ...empty(owner), pending: true });
    try {
      const operation = new FileReader();
      reader.current = operation;
      operation.onerror = () => failed(policy.readFailure);
      operation.onabort = () => {
        if (isCurrent()) { reader.current = null; setState(empty(owner)); }
      };
      operation.onload = () => {
        if (!isCurrent()) return;
        const bytes = operation.result;
        if (!(bytes instanceof ArrayBuffer)) {
          failed(policy.readFailure);
          return;
        }
        if (bytes.byteLength > policy.maximumBytes) {
          failed(policy.tooLarge);
          return;
        }
        let source: string;
        try { source = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
        catch { failed(policy.invalidEncoding); return; }
        reader.current = null;
        latest.current.onLoaded(source);
        setState({ ...empty(owner), fileName: file.name.slice(0, 256) });
      };
      // Bound the read itself, even if the underlying file changes after selection.
      operation.readAsArrayBuffer(file.slice(0, policy.maximumBytes + 1));
    } catch {
      failed(policy.readFailure);
    }
  }, [abort, owner, scopeIsCurrent, workspaceId, policy]);
  return { ...(state.owner === owner ? state : empty(owner)), importFile, cancel };
}
