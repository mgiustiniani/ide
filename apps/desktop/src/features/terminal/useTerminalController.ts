import { useCallback, useEffect } from "react";

export interface TerminalControllerViewModel {
  connect(): void;
  disconnect(): void;
  executeCommand(command: string): Promise<void>;
  updateCurrentInput(value: string): void;
  clearOutput(): void;
}

export interface TerminalControllerSession {
  startSession(): void;
  stopSession(): void;
}

export interface TerminalControllerStore {
  setSessionActive(active: boolean): void;
  setLoading(loading: boolean): void;
}

export interface UseTerminalControllerDependencies {
  viewModel: TerminalControllerViewModel;
  session: TerminalControllerSession;
  getStore: () => TerminalControllerStore;
}

/** Owns the desktop terminal lifecycle and input/command coordination. */
export function useTerminalController({
  viewModel,
  session,
  getStore,
}: UseTerminalControllerDependencies) {
  useEffect(() => {
    // The command terminal is workspace-independent and can start while workspace access resolves.
    viewModel.connect();
    getStore().setSessionActive(true);
    getStore().setLoading(false);
    session.startSession();

    return () => {
      viewModel.disconnect();
      session.stopSession();
      getStore().setSessionActive(false);
    };
  }, [getStore, session, viewModel]);

  const executeCommand = useCallback(
    async (command: string): Promise<void> => {
      try {
        await viewModel.executeCommand(command);
      } catch (error) {
        console.error("[Terminal] Command execution failed", {
          errorType: error instanceof Error ? error.name : typeof error,
        });
      } finally {
        viewModel.updateCurrentInput("");
      }
    },
    [viewModel],
  );

  const updateInput = useCallback(
    (value: string): void => {
      viewModel.updateCurrentInput(value);
    },
    [viewModel],
  );

  const clear = useCallback((): void => {
    viewModel.clearOutput();
  }, [viewModel]);

  const resetWorkspace = useCallback((): void => {
    viewModel.clearOutput();
    viewModel.updateCurrentInput("");
  }, [viewModel]);

  return { executeCommand, updateInput, clear, resetWorkspace };
}
