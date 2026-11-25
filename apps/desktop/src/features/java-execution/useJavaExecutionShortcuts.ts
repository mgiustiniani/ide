import { useEffect, useRef } from "react";
import type { CommandPaletteCommand } from "@ide/ui";

/** Keep form, terminal and modal input local; Java execution remains explicitly configured. */
export function useJavaExecutionShortcuts(options: {
  commands: readonly CommandPaletteCommand[];
  enabled: boolean;
  openConfiguration(): void;
}) {
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (
        !latest.current.enabled ||
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        !["F5", "F10", "F11"].includes(event.key) ||
        event.altKey ||
        (event.ctrlKey && event.metaKey)
      )
        return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (
        document.querySelector(
          '[role="dialog"]:not([hidden]):not([aria-hidden="true"]), [role="alertdialog"]:not([hidden]):not([aria-hidden="true"])',
        ) ||
        target?.closest('[aria-label="Workspace terminal"], .xterm') ||
        (!target?.closest(".monaco-editor") &&
          (target?.isContentEditable ||
            target?.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')))
      )
        return;
      const modifier = event.ctrlKey || event.metaKey;
      const id =
        event.key === "F10"
          ? "step.over"
          : event.key === "F11"
            ? event.shiftKey
              ? "step.out"
              : "step.into"
            : modifier
              ? event.shiftKey
                ? "restart"
                : "run"
              : event.shiftKey
                ? "stop"
                : latest.current.commands.some((item) => item.id === "java.execution.continue")
                  ? "continue"
                  : "debug";
      if (event.key !== "F5" && (modifier || (event.key === "F10" && event.shiftKey))) return;
      const command = latest.current.commands.find((item) => item.id === `java.execution.${id}`);
      if (!command && event.key !== "F5") return;
      event.preventDefault();
      if (command) void command.run();
      else if (id !== "stop") latest.current.openConfiguration();
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);
}
