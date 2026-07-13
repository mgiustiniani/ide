import { useCallback, useState } from "react";

export function useSettingsController() {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback((): void => setIsOpen(true), []);
  const close = useCallback((): void => setIsOpen(false), []);

  return { isOpen, open, close };
}

export interface UseSettingsOpenCoordinatorDependencies {
  open: () => void;
  loadAiAgentConfiguration: () => Promise<unknown>;
  loadAiAgentCommands: () => Promise<unknown>;
  loadWorkspaceMetadata: () => Promise<unknown>;
  refreshJavaLanguage: () => Promise<unknown>;
  refreshRefactorKitStatus: () => Promise<unknown>;
  refreshXcom2Setup: () => Promise<unknown>;
}

/** Opens Settings and refreshes each independently owned settings section. */
export function useSettingsOpenCoordinator({
  open,
  loadAiAgentConfiguration,
  loadAiAgentCommands,
  loadWorkspaceMetadata,
  refreshJavaLanguage,
  refreshRefactorKitStatus,
  refreshXcom2Setup,
}: UseSettingsOpenCoordinatorDependencies) {
  return useCallback((): void => {
    open();
    void loadAiAgentConfiguration();
    void loadAiAgentCommands();
    void loadWorkspaceMetadata();
    void refreshJavaLanguage();
    void refreshRefactorKitStatus();
    void refreshXcom2Setup();
  }, [
    loadAiAgentCommands,
    loadAiAgentConfiguration,
    loadWorkspaceMetadata,
    open,
    refreshJavaLanguage,
    refreshRefactorKitStatus,
    refreshXcom2Setup,
  ]);
}
