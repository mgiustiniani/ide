// ---------------------------------------------------------------------------
// @ide/ui – AiAgentPanel
// Bottom-panel UI for one-shot Pi Agent prompts. Presentation-only: host apps
// provide availability, enablement, errors, and the send/settings callbacks.
// ---------------------------------------------------------------------------

import type { CSSProperties, FormEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AiAgentCommand } from '@ide/contracts';
import { Button } from '../ui/Button';

export type AiAgentMessageRole = 'user' | 'assistant' | 'system';

export interface AiAgentMessage {
  /** Stable message identifier supplied by the host app when available. */
  id?: string;
  /** Message author role. */
  role: AiAgentMessageRole;
  /** Plain-text message content. */
  content: string;
  /** Optional timestamp or label displayed next to the role. */
  createdAt?: string;
}

export interface AiAgentPanelProps {
  /** Conversation messages to render in order. */
  messages: AiAgentMessage[];
  /** Whether Pi Agent runtime/RPC is available. */
  isAvailable: boolean;
  /** Whether Pi Agent is enabled in settings. */
  isEnabled: boolean;
  /** Whether a prompt is currently being sent. */
  isSending: boolean;
  /** Optional user-facing error message. */
  error?: string | null;
  /** Discoverable Pi Agent skills, prompts, and extension commands. */
  commands?: AiAgentCommand[];
  /** Whether command discovery is currently loading. */
  isLoadingCommands?: boolean;
  /** Optional command discovery error message. */
  commandsError?: string | null;
  /** Refreshes command discovery through the host-owned Pi RPC integration. */
  onRefreshCommands?: () => void | Promise<void>;
  /** Sends one trimmed prompt through the host-owned Pi RPC integration. */
  onSendPrompt: (prompt: string) => void | Promise<void>;
  /** Opens settings where the Pi Agent can be enabled/configured. */
  onOpenSettings?: () => void | Promise<void>;
}

const roleLabels: Record<AiAgentMessageRole, string> = {
  user: 'User',
  assistant: 'Assistant',
  system: 'System',
};

const roleStyles: Record<AiAgentMessageRole, string> = {
  user: 'border-blue-500/30 bg-blue-500/10 text-blue-100',
  assistant: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100',
  system: 'border-amber-500/30 bg-amber-500/10 text-amber-100',
};

const commandSourceLabels: Record<AiAgentCommand['source'], string> = {
  skill: 'Skill',
  prompt: 'Prompt',
  extension: 'Extension',
};

const commandSourceOrder: AiAgentCommand['source'][] = ['skill', 'prompt', 'extension'];
const commandPopoverMargin = 12;
const commandPopoverGap = 8;
const commandPopoverMaxWidth = 448;
const commandPopoverMaxHeight = 320;
const commandPopoverMinHeight = 96;

interface CommandPopoverPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

function getUnavailableMessage(isAvailable: boolean, isEnabled: boolean): string | null {
  if (!isEnabled) return 'Pi Agent disabled';
  if (!isAvailable) return 'Pi Agent not available';
  return null;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function getViewportSize(): { width: number; height: number } {
  return {
    width: window.innerWidth || document.documentElement.clientWidth,
    height: window.innerHeight || document.documentElement.clientHeight,
  };
}

function getCommandPopoverPosition(
  triggerElement: HTMLElement,
  popoverElement: HTMLDivElement | null,
): CommandPopoverPosition {
  const triggerRect = triggerElement.getBoundingClientRect();
  const viewport = getViewportSize();
  const availableWidth = Math.max(0, viewport.width - commandPopoverMargin * 2);
  const width = Math.min(commandPopoverMaxWidth, availableWidth);
  const left = clamp(triggerRect.right - width, commandPopoverMargin, viewport.width - commandPopoverMargin - width);
  const availableAbove = Math.max(0, triggerRect.top - commandPopoverMargin - commandPopoverGap);
  const availableBelow = Math.max(0, viewport.height - triggerRect.bottom - commandPopoverMargin - commandPopoverGap);
  const opensAbove = availableAbove >= availableBelow;
  const preferredAvailableHeight = opensAbove ? availableAbove : availableBelow;
  const viewportMaxHeight = Math.max(0, viewport.height - commandPopoverMargin * 2);
  const maxHeight = Math.min(
    commandPopoverMaxHeight,
    viewportMaxHeight,
    Math.max(commandPopoverMinHeight, preferredAvailableHeight),
  );
  const measuredHeight = Math.min(
    maxHeight,
    popoverElement?.getBoundingClientRect().height || popoverElement?.scrollHeight || maxHeight,
  );
  const unclampedTop = opensAbove
    ? triggerRect.top - commandPopoverGap - measuredHeight
    : triggerRect.bottom + commandPopoverGap;
  const top = clamp(unclampedTop, commandPopoverMargin, viewport.height - commandPopoverMargin - measuredHeight);

  return { top, left, width, maxHeight };
}

function getMessageKey(message: AiAgentMessage, index: number): string {
  return message.id ?? `${message.role}-${index}-${message.content.slice(0, 24)}`;
}

function getCommandKey(command: AiAgentCommand, index: number): string {
  return `${command.source}-${command.name}-${command.path ?? command.location ?? index}`;
}

function getCommandInvocation(command: AiAgentCommand): string {
  return `/${command.name} `;
}

function getCommandGroups(commands: AiAgentCommand[]): { source: AiAgentCommand['source']; commands: AiAgentCommand[] }[] {
  return commandSourceOrder
    .map((source) => ({
      source,
      commands: commands.filter((command) => command.source === source),
    }))
    .filter((group) => group.commands.length > 0);
}

function commandMatchesQuery(command: AiAgentCommand, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;

  return [command.name, command.description, command.source, commandSourceLabels[command.source], command.location]
    .filter(Boolean)
    .some((value) => value?.toLowerCase().includes(normalizedQuery));
}

export function AiAgentPanel({
  messages,
  isAvailable,
  isEnabled,
  isSending,
  error,
  commands = [],
  isLoadingCommands = false,
  commandsError,
  onRefreshCommands,
  onSendPrompt,
  onOpenSettings,
}: AiAgentPanelProps): JSX.Element {
  const [prompt, setPrompt] = useState('');
  const [isCommandPickerOpen, setIsCommandPickerOpen] = useState(false);
  const [commandSearch, setCommandSearch] = useState('');
  const [commandPopoverPosition, setCommandPopoverPosition] = useState<CommandPopoverPosition | null>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const commandTriggerRef = useRef<HTMLSpanElement>(null);
  const commandPopoverRef = useRef<HTMLDivElement>(null);
  const disabledMessage = getUnavailableMessage(isAvailable, isEnabled);
  const trimmedPrompt = prompt.trim();
  const canSend = !disabledMessage && !isSending && trimmedPrompt.length > 0;
  const filteredCommands = useMemo(
    () => commands.filter((command) => commandMatchesQuery(command, commandSearch)),
    [commands, commandSearch],
  );
  const commandGroups = getCommandGroups(filteredCommands);
  const commandCountLabel = `${commands.length} ${commands.length === 1 ? 'command' : 'commands'}`;

  useEffect(() => {
    if (!isCommandPickerOpen) {
      setCommandPopoverPosition(null);
      return;
    }

    function updateCommandPopoverPosition(): void {
      if (!commandTriggerRef.current) return;
      setCommandPopoverPosition(getCommandPopoverPosition(commandTriggerRef.current, commandPopoverRef.current));
    }

    updateCommandPopoverPosition();
    const animationFrame = window.requestAnimationFrame?.(updateCommandPopoverPosition);

    window.addEventListener('resize', updateCommandPopoverPosition);
    window.addEventListener('scroll', updateCommandPopoverPosition, true);

    return () => {
      if (animationFrame !== undefined) window.cancelAnimationFrame?.(animationFrame);
      window.removeEventListener('resize', updateCommandPopoverPosition);
      window.removeEventListener('scroll', updateCommandPopoverPosition, true);
    };
  }, [commandSearch, commands.length, commandsError, isCommandPickerOpen, isLoadingCommands]);

  useEffect(() => {
    if (!isCommandPickerOpen) return;

    function handleDocumentMouseDown(event: MouseEvent): void {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (commandPopoverRef.current?.contains(target) || commandTriggerRef.current?.contains(target)) return;

      setIsCommandPickerOpen(false);
    }

    function handleDocumentKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setIsCommandPickerOpen(false);
      }
    }

    document.addEventListener('mousedown', handleDocumentMouseDown);
    document.addEventListener('keydown', handleDocumentKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleDocumentMouseDown);
      document.removeEventListener('keydown', handleDocumentKeyDown);
    };
  }, [isCommandPickerOpen]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSend) return;

    const promptToSend = trimmedPrompt;
    await onSendPrompt(promptToSend);
    setPrompt('');
  }

  function handleUseCommand(command: AiAgentCommand): void {
    setPrompt(getCommandInvocation(command));
    setIsCommandPickerOpen(false);
    setCommandSearch('');
    promptRef.current?.focus();
  }

  const commandPopoverStyle: CSSProperties = {
    position: 'fixed',
    top: commandPopoverPosition?.top ?? commandPopoverMargin,
    left: commandPopoverPosition?.left ?? commandPopoverMargin,
    width: commandPopoverPosition?.width ?? commandPopoverMaxWidth,
    maxHeight: commandPopoverPosition?.maxHeight ?? commandPopoverMaxHeight,
    visibility: commandPopoverPosition ? undefined : 'hidden',
  };

  const commandPicker =
    isCommandPickerOpen && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={commandPopoverRef}
            id="ai-agent-commands-popover"
            role="dialog"
            aria-label="Command picker"
            style={commandPopoverStyle}
            className="z-50 flex flex-col overflow-hidden rounded-md border border-[var(--border-default)] bg-[var(--surface-panel)] shadow-xl"
          >
            <div className="flex items-center justify-between gap-3 border-b border-[var(--border-default)] px-3 py-2">
              <div className="min-w-0">
                <h3 className="truncate text-xs font-semibold uppercase tracking-wide text-[var(--text-primary)]">Skills & commands</h3>
                <p className="truncate text-[11px] text-[var(--text-secondary)]" aria-live="polite">
                  {commandsError ? 'Discovery error' : isLoadingCommands ? 'Loading Pi Agent commands…' : commandCountLabel}
                </p>
              </div>
              {onRefreshCommands ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  onClick={() => void onRefreshCommands()}
                  disabled={isLoadingCommands}
                  isLoading={isLoadingCommands}
                  aria-label="Refresh commands"
                >
                  Refresh
                </Button>
              ) : null}
            </div>

            <div className="border-b border-[var(--border-default)] p-2">
              <label htmlFor="ai-agent-command-search" className="sr-only">
                Search commands
              </label>
              <input
                id="ai-agent-command-search"
                type="search"
                className="w-full rounded-sm border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1 text-xs text-[var(--text-primary)] placeholder:text-[var(--input-placeholder)] focus:border-[var(--input-focus-border)] focus:outline-none"
                placeholder="Search by name, description, or source…"
                value={commandSearch}
                onChange={(event) => setCommandSearch(event.target.value)}
              />
            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
              {commandsError ? (
                <div role="alert" className="rounded-sm border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-200">
                  {commandsError}
                </div>
              ) : null}

              {isLoadingCommands && commands.length === 0 ? (
                <div className="rounded-sm border border-dashed border-[var(--border-default)] bg-[var(--surface-editor)] px-2 py-1 text-xs text-[var(--text-secondary)]">
                  Loading Pi Agent commands…
                </div>
              ) : commands.length === 0 ? (
                <div className="rounded-sm border border-dashed border-[var(--border-default)] bg-[var(--surface-editor)] px-2 py-1 text-xs text-[var(--text-secondary)]">
                  No skills or commands available.
                </div>
              ) : filteredCommands.length === 0 ? (
                <div className="rounded-sm border border-dashed border-[var(--border-default)] bg-[var(--surface-editor)] px-2 py-1 text-xs text-[var(--text-secondary)]">
                  No commands match your search.
                </div>
              ) : (
                <div className="space-y-2">
                  {commandGroups.map((group) => (
                    <div key={group.source}>
                      <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                        {commandSourceLabels[group.source]}
                      </h4>
                      <ul className="space-y-1" aria-label={`${commandSourceLabels[group.source]} commands`}>
                        {group.commands.map((command, index) => (
                          <li
                            key={getCommandKey(command, index)}
                            className="flex items-start justify-between gap-2 rounded-sm border border-[var(--border-default)] bg-[var(--surface-editor)] px-2 py-1.5"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                <span className="break-all font-mono text-xs font-semibold text-[var(--text-primary)]">/{command.name}</span>
                                <span className="rounded-full border border-[var(--border-default)] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[var(--text-secondary)]">
                                  {command.source}
                                </span>
                              </div>
                              {command.description ? (
                                <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-[var(--text-secondary)]">{command.description}</p>
                              ) : (
                                <p className="mt-0.5 text-xs italic text-[var(--text-secondary)]">No description provided.</p>
                              )}
                              {command.location ? (
                                <p className="mt-0.5 truncate text-[10px] text-[var(--text-tertiary)]">Source: {command.location}</p>
                              ) : null}
                            </div>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              className="shrink-0"
                              onClick={() => handleUseCommand(command)}
                              aria-label={`Use ${command.name}`}
                            >
                              Use
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-[var(--surface-editor)] text-[var(--text-primary)]"
      aria-label="AI Agent"
    >
      <header className="flex items-center justify-between gap-3 border-b border-[var(--border-default)] bg-[var(--surface-panel)] px-3 py-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-[var(--text-primary)]">AI Agent</h2>
          <p className="truncate text-xs text-[var(--text-secondary)]">Pi RPC one-shot assistant</p>
        </div>
        {onOpenSettings ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => void onOpenSettings()}>
            Settings
          </Button>
        ) : null}
      </header>

      {disabledMessage ? (
        <div className="border-b border-[var(--border-default)] bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          <div className="flex flex-wrap items-center gap-2">
            <span>{disabledMessage}</span>
            {onOpenSettings ? (
              <button
                type="button"
                className="text-xs font-medium text-[var(--text-accent)] underline underline-offset-2 hover:text-blue-300"
                onClick={() => void onOpenSettings()}
              >
                Open Settings
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {error ? (
        <div role="alert" className="border-b border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {messages.length === 0 ? (
          <div className="flex h-full min-h-[8rem] items-center justify-center rounded-md border border-dashed border-[var(--border-default)] bg-[var(--surface-panel)] p-6 text-center text-sm text-[var(--text-secondary)]">
            Ask the Pi Agent a one-shot question about your workspace.
          </div>
        ) : (
          <ol className="space-y-3" aria-label="AI Agent messages">
            {messages.map((message, index) => (
              <li
                key={getMessageKey(message, index)}
                className={`rounded-md border px-3 py-2 shadow-sm ${roleStyles[message.role]}`}
              >
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide">
                  <span>{roleLabels[message.role]}</span>
                  {message.createdAt ? <span className="font-normal normal-case opacity-70">{message.createdAt}</span> : null}
                </div>
                <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.content}</p>
              </li>
            ))}
          </ol>
        )}
      </div>

      <form onSubmit={(event) => void handleSubmit(event)} className="relative border-t border-[var(--border-default)] bg-[var(--surface-panel)] p-3">
        {commandPicker}

        <div className="mb-1 flex items-center justify-between gap-2">
          <label htmlFor="ai-agent-prompt" className="block text-xs font-medium text-[var(--text-secondary)]">
            Prompt
          </label>
          <span ref={commandTriggerRef} className="shrink-0">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={isCommandPickerOpen}
              aria-controls="ai-agent-commands-popover"
              aria-haspopup="dialog"
              onClick={() => setIsCommandPickerOpen((isOpen) => !isOpen)}
            >
              Commands ({commands.length})
            </Button>
          </span>
        </div>
        <div className="flex gap-2">
          <textarea
            ref={promptRef}
            id="ai-agent-prompt"
            className="min-h-[4.5rem] flex-1 resize-none rounded-sm border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--input-placeholder)] focus:border-[var(--input-focus-border)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            placeholder="Ask Pi Agent…"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            disabled={Boolean(disabledMessage) || isSending}
          />
          <div className="flex items-end">
            <Button type="submit" size="md" disabled={!canSend} isLoading={isSending}>
              Send
            </Button>
          </div>
        </div>
      </form>
    </section>
  );
}
