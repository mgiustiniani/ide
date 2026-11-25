import type { CommandPaletteCommand } from "@ide/ui";
import type { WorkspaceTerminalController } from "@ide/web-core/terminal/WorkspaceTerminalController";

/** Terminal commands use the same session owner and trust checks as the panel. */
export function workspaceTerminalCommands(
  controller: WorkspaceTerminalController,
  open: () => void,
): CommandPaletteCommand[] {
  const state = controller.getState();
  const context = state.capabilities;
  const currentContext = () => !!context && controller.getState().capabilities === context;
  const commands: CommandPaletteCommand[] = [{
    id: "terminal.open", label: "Show workspace terminal", category: "Terminal", run: open,
  }];
  if (state.trusted && context?.available && !state.pending && state.sessions.length < 8)
    commands.push({
      id: "terminal.new", label: "New terminal at workspace root", category: "Terminal",
      description: "Starts the provider's default shell in the workspace root. Requires workspace shell trust.",
      run: () => {
        if (!currentContext()) return;
        open();
        return controller.start(".");
      },
    });
  const active = state.sessions.find(item => item.snapshot.sessionId === state.activeSessionId);
  if (active) {
    const currentSelection = () => currentContext() &&
      controller.getState().activeSessionId === active.snapshot.sessionId;
    if (!active.busy) {
      if (!["exited", "stopped"].includes(active.snapshot.state))
        commands.push({
          id: "terminal.stop", label: "Stop selected workspace terminal", category: "Terminal",
          run: () => {
            if (!currentSelection()) return;
            open();
            return controller.stop();
          },
        });
      commands.push({
        id: "terminal.close", label: "Close selected workspace terminal", category: "Terminal",
        run: () => {
          if (!currentSelection()) return;
          open();
          return controller.stop(true);
        },
      });
    }
    commands.push({
      id: "terminal.clear", label: "Clear selected terminal display", category: "Terminal",
      description: "Clears the display without changing the shell or its history.",
      run: () => {
        if (!currentSelection()) return;
        open();
        controller.clear();
      },
    });
  }
  return commands;
}
