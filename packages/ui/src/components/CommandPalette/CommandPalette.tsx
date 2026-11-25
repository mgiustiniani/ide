import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

export interface CommandPaletteCommand {
  readonly id: string;
  readonly label: string;
  readonly category?: string;
  readonly description?: string;
  readonly shortcut?: string;
  readonly run: () => void | Promise<void>;
}

export interface CommandPaletteProps {
  readonly open: boolean;
  readonly commands: readonly CommandPaletteCommand[];
  readonly onOpen: () => void;
  readonly onClose: () => void;
}

/** A searchable, host-composed command surface. Commands remain responsible for capability checks. */
export function CommandPalette({
  open,
  commands,
  onOpen,
  onClose,
}: CommandPaletteProps): JSX.Element | null {
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const openRef = useRef(open);
  const callbacksRef = useRef({ onOpen, onClose });
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  openRef.current = open;
  callbacksRef.current = { onOpen, onClose };

  const filteredCommands = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter((command) =>
      [command.label, command.category, command.description, command.shortcut]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [commands, query]);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery("");
    setSelectedIndex(0);
    setError(null);
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => previousFocusRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const handleGlobalShortcut = (event: globalThis.KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.altKey ||
        event.shiftKey !== true ||
        (!event.ctrlKey && !event.metaKey) ||
        event.key.toLocaleLowerCase() !== "p"
      )
        return;

      const target = event.target instanceof HTMLElement ? event.target : null;
      const inPalette = Boolean(target?.closest("[data-command-palette]"));
      if (isTextEntryTarget(target) && !inPalette) return;

      event.preventDefault();
      if (openRef.current) callbacksRef.current.onClose();
      else callbacksRef.current.onOpen();
    };
    window.addEventListener("keydown", handleGlobalShortcut);
    return () => window.removeEventListener("keydown", handleGlobalShortcut);
  }, []);

  if (!open) return null;

  const execute = async (command: CommandPaletteCommand) => {
    setError(null);
    try {
      await command.run();
      callbacksRef.current.onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The command could not be completed.");
    }
  };

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && filteredCommands.length > 0) {
      event.preventDefault();
      setSelectedIndex((index) => (index + 1) % filteredCommands.length);
    } else if (event.key === "ArrowUp" && filteredCommands.length > 0) {
      event.preventDefault();
      setSelectedIndex((index) => (index - 1 + filteredCommands.length) % filteredCommands.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const selected = filteredCommands[selectedIndex];
      if (selected) void execute(selected);
    }
  };

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      callbacksRef.current.onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      "input:not([disabled]), button:not([disabled])",
    );
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/60 px-4 pt-[14vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) callbacksRef.current.onClose();
      }}
    >
      <section
        aria-label="Command palette"
        aria-modal="true"
        className="w-full max-w-2xl overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--surface-panel)] shadow-2xl"
        data-command-palette
        onKeyDown={handleDialogKeyDown}
        ref={dialogRef}
        role="dialog"
      >
        <div className="border-b border-[var(--border-default)] px-3 py-3">
          <input
            aria-activedescendant={
              filteredCommands.length > 0 ? `command-palette-option-${selectedIndex}` : undefined
            }
            aria-controls="command-palette-list"
            aria-expanded="true"
            aria-label="Search commands"
            autoComplete="off"
            className="w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-background)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--border-focus)]"
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              setSelectedIndex(0);
              setError(null);
            }}
            onKeyDown={handleInputKeyDown}
            placeholder="Type a command to search"
            ref={inputRef}
            role="combobox"
            value={query}
          />
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            Search available commands · Esc to close
          </p>
        </div>
        <div
          aria-label="Available commands"
          className="max-h-[55vh] overflow-y-auto p-1"
          id="command-palette-list"
          role="listbox"
        >
          {filteredCommands.map((command, index) => (
            <button
              aria-selected={index === selectedIndex}
              aria-label={`${command.label}${command.category ? ` ${command.category}` : ""}`}
              className={`flex w-full items-center justify-between gap-4 rounded px-3 py-2 text-left text-sm ${index === selectedIndex ? "bg-[var(--highlight-bg)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--highlight-bg)] hover:text-[var(--text-primary)]"}`}
              id={`command-palette-option-${index}`}
              key={command.id}
              onClick={() => void execute(command)}
              onMouseEnter={() => setSelectedIndex(index)}
              role="option"
              type="button"
            >
              <span className="min-w-0">
                <span className="block truncate">{command.label}</span>
                {command.description ? (
                  <span className="mt-0.5 block truncate text-xs text-[var(--text-muted)]">
                    {command.description}
                  </span>
                ) : null}
              </span>
              <span className="flex shrink-0 items-center gap-2 text-xs text-[var(--text-muted)]">
                {command.category ? <span>{command.category}</span> : null}
                {command.shortcut ? <kbd>{command.shortcut}</kbd> : null}
              </span>
            </button>
          ))}
          {filteredCommands.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-[var(--text-muted)]">
              No commands match “{query}”.
            </p>
          ) : null}
        </div>
        {error ? (
          <p
            className="border-t border-[var(--border-default)] px-3 py-2 text-sm text-rose-300"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}

function isTextEntryTarget(target: HTMLElement | null): boolean {
  if (!target) return false;
  if (target.closest(".monaco-editor")) return false;
  return (
    target.isContentEditable ||
    target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]') !== null
  );
}
