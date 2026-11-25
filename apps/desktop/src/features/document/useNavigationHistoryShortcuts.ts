import { useEffect, useRef } from "react";

export function useNavigationHistoryShortcuts(options: {
  enabled: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  goBack(): Promise<boolean>;
  goForward(): Promise<boolean>;
}) {
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      const state = latest.current;
      if (
        !state.enabled ||
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        !event.altKey ||
        !(event.ctrlKey || event.metaKey) ||
        (event.ctrlKey && event.metaKey) ||
        event.shiftKey ||
        !["ArrowLeft", "ArrowRight"].includes(event.key)
      )
        return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (
        document.querySelector(
          '[role="dialog"]:not([hidden]):not([aria-hidden="true"]), [role="alertdialog"]:not([hidden]):not([aria-hidden="true"])',
        ) ||
        target?.closest('.xterm, [aria-label="Workspace terminal"]') ||
        (!target?.closest(".monaco-editor") &&
          (target?.isContentEditable ||
            target?.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')))
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "ArrowLeft" && state.canGoBack) void state.goBack();
      else if (event.key === "ArrowRight" && state.canGoForward) void state.goForward();
    };
    window.addEventListener("keydown", handle, true);
    return () => window.removeEventListener("keydown", handle, true);
  }, []);
}
