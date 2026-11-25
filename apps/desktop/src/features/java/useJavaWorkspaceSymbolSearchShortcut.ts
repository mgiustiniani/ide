import { useEffect, useRef } from "react";

/** Open the JDT LS workspace-symbol search from the editor without owning its query or provider. */
export function useJavaWorkspaceSymbolSearchShortcut(onOpen: () => void): void {
  useJavaModifierShortcut("t", false, onOpen);
}

/** Open Java project text search from the editor without taking shortcuts from text controls. */
export function useJavaProjectTextSearchShortcut(onOpen: () => void): void {
  useJavaModifierShortcut("f", true, onOpen);
}

function useJavaModifierShortcut(key: string, requireShift: boolean, onOpen: () => void): void {
  const openRef = useRef(onOpen);

  useEffect(() => {
    openRef.current = onOpen;
  }, [onOpen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        isTextEntryTarget(event.target) ||
        event.altKey ||
        event.shiftKey !== requireShift ||
        (!event.ctrlKey && !event.metaKey) ||
        event.key.toLowerCase() !== key
      )
        return;

      event.preventDefault();
      openRef.current();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest(".monaco-editor")) return false;

  return (
    target.isContentEditable ||
    target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]') !== null
  );
}
