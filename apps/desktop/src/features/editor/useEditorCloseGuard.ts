import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** Refuse close while source buffers or database work need the user's decision. */
export function useEditorCloseGuard(
  getState: () => { tabs: Array<{ isDirty: boolean }>; blockReason?: string | null },
  reportError: (message: string) => void,
) {
  useEffect(() => {
    const reason = () => {
      const state = getState();
      return state.tabs.some((tab) => tab.isDirty)
        ? "Save modified files before closing the IDE."
        : state.blockReason;
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (reason()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const native = (window as unknown as { __TAURI_INTERNALS__?: { metadata?: unknown } })
      .__TAURI_INTERNALS__;
    if (native?.metadata) {
      try {
        void getCurrentWindow()
          .onCloseRequested((event) => {
            // Tauri destroys the window when a close callback returns without
            // preventing default; a retired listener must never authorize that.
            if (disposed) {
              event.preventDefault();
              return;
            }
            const blocked = reason();
            if (blocked) {
              event.preventDefault();
              reportError(blocked);
            }
          })
          .then((cleanup) => {
            if (disposed) cleanup();
            else unlisten = cleanup;
          })
          .catch(() => {
            if (!disposed)
              reportError(
                "The native close guard could not be installed. Save your files before closing.",
              );
          });
      } catch {
        reportError(
          "The native close guard could not be installed. Save your files before closing.",
        );
      }
    }
    return () => {
      disposed = true;
      unlisten?.();
      window.removeEventListener("beforeunload", unload);
    };
  }, [getState, reportError]);
}
