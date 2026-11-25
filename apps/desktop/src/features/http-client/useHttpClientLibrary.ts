import {
  normalizeHttpLibrary,
  type HttpRequestLibrary,
  type HttpLibrarySnapshot,
} from "@ide/contracts";
import type { HttpClientPort } from "@ide/web-core/ports";
import { useCallback, useEffect, useRef, useState } from "react";
import { emptyHttpLibrary } from "./httpLibrary";

export function useHttpClientLibrary(
  port: HttpClientPort,
  workspaceId: string | null,
  generation: number,
) {
  const key = JSON.stringify([workspaceId, generation]);
  const [state, setState] = useState({
    owner: key,
    library: emptyHttpLibrary(),
    revision: null as string | null,
    busy: false,
    error: null as string | null,
  });
  const current = useRef({ workspaceId, generation, port });
  current.current = { workspaceId, generation, port };
  const sequence = useRef(0);
  const alive = useRef(false);
  const inFlight = useRef(false);
  const exporting = useRef<number | null>(null);
  const exportSequence = useRef(0);
  const snapshot = useRef(state);
  snapshot.current = state;
  const available = Boolean(port.loadLibrary && port.saveLibrary && workspaceId);

  const execute = useCallback(
    async (next?: HttpRequestLibrary) => {
      if (
        !workspaceId ||
        !port.loadLibrary ||
        !port.saveLibrary ||
        inFlight.current ||
        current.current.port !== port ||
        current.current.workspaceId !== workspaceId ||
        current.current.generation !== generation ||
        !alive.current
      )
        return;
      const revision = snapshot.current.revision;
      if (next && (!revision || snapshot.current.owner !== key)) return;
      inFlight.current = true;
      const serial = ++sequence.current;
      const request = {
        workspaceId,
        generation,
        requestId: `http-library-${Date.now()}-${serial}`,
      };
      const isCurrent = () =>
        alive.current &&
        sequence.current === serial &&
        current.current.port === port &&
        current.current.workspaceId === workspaceId &&
        current.current.generation === generation;
      setState((state) => ({ ...state, busy: true, error: null }));
      try {
        const result: HttpLibrarySnapshot = next
          ? await port.saveLibrary({
              ...request,
              expectedRevision: revision!,
              library: normalizeHttpLibrary(next),
            })
          : await port.loadLibrary(request);
        if (!isCurrent()) return;
        if (
          result.workspaceId !== workspaceId ||
          result.generation !== generation ||
          result.requestId !== request.requestId ||
          !/^[a-f0-9]{64}$/u.test(result.revision)
        )
          throw new Error("The saved HTTP collections belong to another request or workspace.");
        setState({
          owner: key,
          library: normalizeHttpLibrary(result.library),
          revision: result.revision,
          busy: false,
          error: null,
        });
        return result;
      } catch (error) {
        if (isCurrent())
          setState((state) => ({
            ...state,
            busy: false,
            error: error instanceof Error ? error.message : "HTTP collections are unavailable.",
          }));
      } finally {
        if (serial === sequence.current) inFlight.current = false;
      }
    },
    [port, workspaceId, generation, key],
  );

  useEffect(() => {
    alive.current = true;
    exporting.current = null;
    exportSequence.current += 1;
    sequence.current += 1;
    inFlight.current = false;
    setState({ owner: key, library: emptyHttpLibrary(), revision: null, busy: false, error: null });
    void execute();
    return () => {
      alive.current = false;
      sequence.current += 1;
      inFlight.current = false;
    };
  }, [execute, key]);
  const exportLibraryFile = useCallback(
    async (filePath?: string) => {
      const value = snapshot.current;
      if (
        !alive.current ||
        !workspaceId ||
        (filePath === undefined ? !port.exportLibraryAs : !port.exportLibrary) ||
        exporting.current ||
        inFlight.current ||
        value.owner !== key ||
        !value.revision ||
        current.current.port !== port ||
        current.current.workspaceId !== workspaceId ||
        current.current.generation !== generation
      )
        return;
      const serial = ++exportSequence.current;
      exporting.current = serial;
      const request = {
        workspaceId,
        generation,
        requestId: `http-export-${Date.now()}-${serial}`,
        expectedRevision: value.revision,
      };
      const isCurrent = () =>
        alive.current &&
        serial === exportSequence.current &&
        current.current.port === port &&
        current.current.workspaceId === workspaceId &&
        current.current.generation === generation;
      try {
        const result =
          filePath === undefined
            ? await port.exportLibraryAs!({
                workspaceId,
                generation,
                requestId: request.requestId,
                expectedRevision: request.expectedRevision,
              })
            : await port.exportLibrary!({ ...request, filePath });
        if (!isCurrent()) return;
        if (result === null && filePath === undefined) return null;
        if (
          !result ||
          result.workspaceId !== workspaceId ||
          result.generation !== generation ||
          result.requestId !== request.requestId ||
          result.revision !== request.expectedRevision ||
          (filePath !== undefined && result.filePath !== filePath) ||
          typeof result.filePath !== "string" ||
          !result.filePath ||
          result.filePath.length > 32768 ||
          /[\p{Cc}]/u.test(result.filePath) ||
          !Number.isSafeInteger(result.byteLength) ||
          result.byteLength < 1 ||
          result.byteLength > 2 * 1024 * 1024
        )
          throw new Error("The HTTP export response does not match this request.");
        return result;
      } catch (error) {
        if (isCurrent()) throw error;
        return undefined;
      } finally {
        if (exporting.current === serial) exporting.current = null;
      }
    },
    [workspaceId, generation, key, port],
  );
  return {
    exportFile: port.exportLibrary ? (filePath: string) => exportLibraryFile(filePath) : undefined,
    exportAs: port.exportLibraryAs ? () => exportLibraryFile() : undefined,
    ...(state.owner === key
      ? state
      : { owner: key, library: emptyHttpLibrary(), revision: null, busy: available, error: null }),
    available,
    reload: () => execute(),
    save: (library: HttpRequestLibrary) => execute(library),
  };
}
