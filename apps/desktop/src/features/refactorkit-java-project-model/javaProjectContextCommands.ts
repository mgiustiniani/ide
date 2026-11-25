import { isJavaGradleSettings } from "@ide/contracts";
import type { CommandPaletteCommand } from "@ide/ui";
import type { JavaProjectContextController } from "./useJavaProjectContextController";

export interface JavaProjectCommandState {
  workspaceId: string | null;
  generation: number;
  isSwitching: boolean;
  isMetadataLoading: boolean;
  isWriting: boolean;
  controller: Pick<JavaProjectContextController, "settings" | "isBusy" | "synchronize" | "evaluateGradle">;
}

function available(state: JavaProjectCommandState): boolean {
  return Boolean(state.workspaceId && !state.isSwitching && !state.isMetadataLoading &&
    !state.isWriting && !state.controller.isBusy && state.controller.settings.sdkHome.trim());
}

/** Explicit commands share Java Project's acquisition path and never save editor buffers. */
export function javaProjectContextCommands(
  state: JavaProjectCommandState,
  getCurrent: () => JavaProjectCommandState,
  openProject: () => void,
): CommandPaletteCommand[] {
  if (!available(state)) return [];
  const { workspaceId, generation } = state;
  const signature = JSON.stringify(state.controller.settings);
  const command = (evaluate: boolean): CommandPaletteCommand => ({
    id: evaluate ? "java.project-context.evaluate-gradle" : "java.project-context.synchronize",
    label: evaluate ? "Evaluate Gradle Project and Synchronize" : "Synchronize Java Project",
    category: "Java · Project",
    description: evaluate
      ? "Runs Gradle build scripts with the selected JDK and Gradle settings. Unsaved edits are preserved."
      : "Reads saved project inputs with the selected JDK. Preserves unsaved edits and does not evaluate Gradle.",
    run: () => {
      const current = getCurrent();
      if (!available(current) || current.workspaceId !== workspaceId || current.generation !== generation ||
        JSON.stringify(current.controller.settings) !== signature ||
        (evaluate && !isJavaGradleSettings(current.controller.settings.gradle))) return;
      openProject();
      // The controller owns progress and errors; leave its panel available during acquisition.
      if (evaluate) void current.controller.evaluateGradle();
      else void current.controller.synchronize();
    },
  });
  return [command(false), ...(isJavaGradleSettings(state.controller.settings.gradle) ? [command(true)] : [])];
}
