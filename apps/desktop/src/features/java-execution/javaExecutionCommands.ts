import { isJavaDebuggingOperation } from "@ide/contracts";
import type { CommandPaletteCommand } from "@ide/ui";
import type { JavaExecutionOperation } from "@ide/contracts";
import type { JavaExecutionController } from "./useJavaExecutionController";
import { javaDebuggerAvailability } from "./javaDebuggerAvailability";
import {
  javaExecutionAvailability,
  type JavaExecutionAvailabilityState,
} from "./javaExecutionAvailability";

type Controller = JavaExecutionAvailabilityState &
  Pick<
    JavaExecutionController,
    "snapshot" | "start" | "stop" | "restart" | "rerunFailed" | "debugAction"
  >;

/** Run the selected configuration through the same controller used by Java Run. */
export function javaExecutionCommands(
  controller: Controller,
  open: () => void,
): CommandPaletteCommand[] {
  const availability = javaExecutionAvailability(controller);
  const operations: { operation: JavaExecutionOperation; label: string; shortcut?: string }[] = [
    { operation: "clean", label: "Clean configured Java project outputs" },
    { operation: "rebuild", label: "Rebuild configured Java project" },
    { operation: "build", label: "Build configured Java project" },
    { operation: "run", label: "Run configured Java application", shortcut: "Ctrl/Cmd+F5" },
    { operation: "debug", label: "Debug configured Java application", shortcut: "F5" },
    { operation: "test", label: "Run configured Java tests" },
    { operation: "debug-test", label: "Debug configured Java test" },
    { operation: "debug-integration-test", label: "Debug configured Java integration test" },
    { operation: "integration-test", label: "Run configured Java integration tests" },
    { operation: "coverage", label: "Run configured Java tests with coverage" },
    {
      operation: "integration-coverage",
      label: "Run configured Java integration tests with coverage",
    },
    { operation: "discover", label: "Discover configured Java tests" },
  ];
  const commands: CommandPaletteCommand[] = operations
    .filter(({ operation }) => availability.canStart(operation))
    .map(({ operation, label, shortcut }) => ({
      id: `java.execution.${operation}`,
      label,
      category: "Java · Run",
      shortcut,
      description: "Uses the selected saved Java configuration.",
      run: () => {
        open();
        return controller.start(operation);
      },
    }));
  if (availability.canStart("run", true))
    commands.push({
      id: "java.execution.jfr",
      label: "Run configured Java application with JFR",
      category: "Java · Run",
      run: () => {
        open();
        return controller.start("run", true);
      },
    });
  if (availability.canAttach)
    commands.push({
      id: "java.execution.attach",
      label: "Attach configured Java debugger",
      category: "Java · Run",
      run: () => {
        open();
        return controller.start("attach");
      },
    });
  if (availability.canStop)
    commands.push({
      id: "java.execution.stop",
      label:
        controller.snapshot?.operation === "attach" ? "Detach Java debugger" : "Stop Java session",
      category: "Java · Run",
      shortcut: "Shift+F5",
      run: () => {
        open();
        return controller.stop();
      },
    });
  if (availability.canRerunFailed)
    commands.push({
      id: "java.execution.rerun-failed",
      label: "Rerun failed Java tests",
      category: "Java · Run",
      description: "Uses the failed session’s captured test settings.",
      run: () => {
        open();
        return controller.rerunFailed();
      },
    });
  if (availability.canDebugFailed)
    commands.push({
      id: "java.execution.debug-failed",
      label: "Debug failed Java tests",
      category: "Java · Run",
      description: "Saves current edits and debugs failures using the completed session's captured JDK and test settings.",
      run: () => { open(); return controller.rerunFailed(true); },
    });
  if (availability.canRestart)
    commands.push({
      id: "java.execution.restart",
      label: controller.running ? "Restart captured Java session" : "Rerun captured Java session",
      category: "Java · Run",
      shortcut: "Ctrl/Cmd+Shift+F5",
      description: "Saves editor changes and uses the session's captured launch settings.",
      run: () => {
        open();
        return controller.restart();
      },
    });
  const state = controller.snapshot?.debuggerState;
  const debug = javaDebuggerAvailability(
    state,
    controller.running && isJavaDebuggingOperation(controller.snapshot?.operation),
  );
  if (debug.suspended)
    commands.push({
      id: "java.execution.continue",
      label: "Continue Java debugger",
      category: "Java · Run",
      shortcut: "F5",
      run: () => {
        open();
        return controller.debugAction({ type: "continue", stopId: state!.stopId! });
      },
    });
  if (debug.canPause)
    commands.push({
      id: "java.execution.pause",
      label: "Pause Java debugger",
      category: "Java · Run",
      run: () => {
        open();
        return controller.debugAction({ type: "pause" });
      },
    });
  if (debug.canStep)
    for (const [kind, label, shortcut] of [
      ["over", "Step over in Java debugger", "F10"],
      ["into", "Step into in Java debugger", "F11"],
      ["out", "Step out in Java debugger", "Shift+F11"],
    ] as const)
      commands.push({
        id: `java.execution.step.${kind}`,
        label,
        category: "Java · Run",
        shortcut,
        run: () => {
          open();
          return controller.debugAction({ type: "step", stopId: state!.stopId!, kind });
        },
      });
  return commands;
}
