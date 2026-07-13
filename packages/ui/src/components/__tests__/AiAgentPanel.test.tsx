// ---------------------------------------------------------------------------
// @ide/ui – AiAgentPanel Component Tests
// ---------------------------------------------------------------------------

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AiAgentPanel } from '../AiAgentPanel/AiAgentPanel';
import type { AiAgentCommand } from '@ide/contracts';
import type { AiAgentMessage } from '../AiAgentPanel/AiAgentPanel';

const messages: AiAgentMessage[] = [
  { id: 'system-1', role: 'system', content: 'Pi RPC session ready.' },
  { id: 'user-1', role: 'user', content: 'Explain this repository.' },
  { id: 'assistant-1', role: 'assistant', content: 'This is a Tauri IDE workspace.' },
];

const commands: AiAgentCommand[] = [
  {
    name: 'skill:refactorkit',
    description: 'Java code intelligence and refactoring engine.',
    source: 'skill',
    location: 'local skill pack',
  },
  {
    name: 'summarize',
    description: 'Summarize the current context.',
    source: 'prompt',
  },
  {
    name: 'wiki_status',
    source: 'extension',
  },
];

describe('AiAgentPanel', () => {
  it('renders the AI Agent panel with messages and settings action', () => {
    const onOpenSettings = vi.fn();

    render(
      React.createElement(AiAgentPanel, {
        messages,
        isAvailable: true,
        isEnabled: true,
        isSending: false,
        error: 'Previous prompt failed.',
        onSendPrompt: vi.fn(),
        onOpenSettings,
      }),
    );

    expect(screen.getByRole('region', { name: 'AI Agent' })).toBeDefined();
    expect(screen.getByText('Pi RPC one-shot assistant')).toBeDefined();
    expect(screen.queryByRole('dialog', { name: 'Command picker' })).toBeNull();
    expect(screen.getByText('Pi RPC session ready.')).toBeDefined();
    expect(screen.getByText('Explain this repository.')).toBeDefined();
    expect(screen.getByText('This is a Tauri IDE workspace.')).toBeDefined();
    expect(screen.getByRole('alert').textContent).toBe('Previous prompt failed.');

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('disables prompt input and send when Pi Agent is disabled or unavailable', () => {
    const onOpenSettings = vi.fn();
    const onSendPrompt = vi.fn();

    render(
      React.createElement(AiAgentPanel, {
        messages: [],
        isAvailable: true,
        isEnabled: false,
        isSending: false,
        onSendPrompt,
        onOpenSettings,
      }),
    );

    const promptInput = screen.getByLabelText('Prompt') as HTMLTextAreaElement;
    const sendButton = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;

    expect(screen.getByText('Pi Agent disabled')).toBeDefined();
    expect(promptInput.disabled).toBe(true);
    expect(sendButton.disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onSendPrompt).not.toHaveBeenCalled();
  });

  it('keeps commands out of the chat flow and opens grouped command discovery in a popover', () => {
    render(
      React.createElement(AiAgentPanel, {
        messages: [],
        isAvailable: true,
        isEnabled: true,
        isSending: false,
        commands,
        onSendPrompt: vi.fn(),
      }),
    );

    const commandsButton = screen.getByRole('button', { name: 'Commands (3)' });
    expect(commandsButton.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('dialog', { name: 'Command picker' })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Skill commands' })).toBeNull();

    fireEvent.click(commandsButton);

    expect(commandsButton.getAttribute('aria-expanded')).toBe('true');
    const commandDialog = screen.getByRole('dialog', { name: 'Command picker' });
    expect(commandDialog).toBeDefined();
    expect(commandDialog.parentElement).toBe(document.body);
    expect(commandDialog.style.position).toBe('fixed');
    expect(commandDialog.style.maxHeight).toMatch(/px$/);
    expect(screen.getByRole('list', { name: 'Skill commands' })).toBeDefined();
    expect(screen.getByRole('list', { name: 'Prompt commands' })).toBeDefined();
    expect(screen.getByRole('list', { name: 'Extension commands' })).toBeDefined();
    expect(screen.getByText('/skill:refactorkit')).toBeDefined();
    expect(screen.getByText('Java code intelligence and refactoring engine.')).toBeDefined();
    expect(screen.getByText('Source: local skill pack')).toBeDefined();
    expect(screen.getAllByText('skill')[0]).toBeDefined();
  });

  it('filters commands and inserts a slash command into the prompt while collapsing the list', () => {
    render(
      React.createElement(AiAgentPanel, {
        messages: [],
        isAvailable: true,
        isEnabled: true,
        isSending: false,
        commands,
        onSendPrompt: vi.fn(),
      }),
    );

    const commandsButton = screen.getByRole('button', { name: 'Commands (3)' });
    fireEvent.click(commandsButton);
    fireEvent.change(screen.getByLabelText('Search commands'), { target: { value: 'java' } });

    expect(screen.getByText('/skill:refactorkit')).toBeDefined();
    expect(screen.queryByText('/summarize')).toBeNull();

    const promptInput = screen.getByLabelText('Prompt') as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole('button', { name: 'Use skill:refactorkit' }));

    expect(promptInput.value).toBe('/skill:refactorkit ');
    expect(commandsButton.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('dialog', { name: 'Command picker' })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Skill commands' })).toBeNull();
  });

  it('closes the command popover on Escape and outside click', () => {
    render(
      React.createElement(AiAgentPanel, {
        messages: [],
        isAvailable: true,
        isEnabled: true,
        isSending: false,
        commands,
        onSendPrompt: vi.fn(),
      }),
    );

    const commandsButton = screen.getByRole('button', { name: 'Commands (3)' });
    fireEvent.click(commandsButton);
    expect(screen.getByRole('dialog', { name: 'Command picker' })).toBeDefined();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Command picker' })).toBeNull();

    fireEvent.click(commandsButton);
    expect(screen.getByRole('dialog', { name: 'Command picker' })).toBeDefined();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog', { name: 'Command picker' })).toBeNull();
  });

  it('renders command popover error, loading, refresh, and empty states', () => {
    const onRefreshCommands = vi.fn();

    render(
      React.createElement(AiAgentPanel, {
        messages: [],
        isAvailable: true,
        isEnabled: true,
        isSending: false,
        commands: [],
        isLoadingCommands: true,
        commandsError: 'Command discovery failed.',
        onRefreshCommands,
        onSendPrompt: vi.fn(),
      }),
    );

    expect(screen.queryByText('Command discovery failed.')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Commands (0)' }));

    const refreshButton = screen.getByRole('button', { name: 'Refresh commands' }) as HTMLButtonElement;
    expect(refreshButton.disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toBe('Command discovery failed.');
    expect(screen.getAllByText('Loading Pi Agent commands…').length).toBeGreaterThan(0);
  });

  it('renders a command empty state when no commands are available', () => {
    render(
      React.createElement(AiAgentPanel, {
        messages: [],
        isAvailable: true,
        isEnabled: true,
        isSending: false,
        commands: [],
        onSendPrompt: vi.fn(),
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Commands (0)' }));
    expect(screen.getByText('No skills or commands available.')).toBeDefined();
  });

  it('sends a trimmed one-shot prompt and clears the textarea', async () => {
    const onSendPrompt = vi.fn().mockResolvedValue(undefined);

    render(
      React.createElement(AiAgentPanel, {
        messages: [],
        isAvailable: true,
        isEnabled: true,
        isSending: false,
        onSendPrompt,
      }),
    );

    const promptInput = screen.getByLabelText('Prompt') as HTMLTextAreaElement;
    fireEvent.change(promptInput, { target: { value: '  Summarize active file  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(onSendPrompt).toHaveBeenCalledWith('Summarize active file'));
    expect(promptInput.value).toBe('');
  });
});
