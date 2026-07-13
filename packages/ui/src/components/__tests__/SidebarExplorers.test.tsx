import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WorkspaceInfo, WorkspaceRegistry } from '@ide/contracts';
import { LeftSidebar } from '../PanelLayout/LeftSidebar';
import { WorkspaceExplorer } from '../WorkspaceExplorer/WorkspaceExplorer';

const workspace = (index: number): WorkspaceInfo => ({
  id: `workspace-${index}`,
  name: `Workspace ${index}`,
  rootPath: `/home/developer/projects/workspace-${index}`,
});

const registry: WorkspaceRegistry = {
  workspaces: Array.from({ length: 8 }, (_, index) => workspace(index + 1)),
  currentWorkspaceId: 'workspace-1',
};

describe('LeftSidebar accordion', () => {
  it('independently expands and collapses Files and Workspaces', async () => {
    render(
      <LeftSidebar isVisible onToggle={vi.fn()} workspaceContent={<div>Workspace content</div>}>
        <div>File content</div>
      </LeftSidebar>,
    );

    const files = screen.getByRole('button', { name: 'File Explorer' });
    const workspaces = screen.getByRole('button', { name: 'Workspace Explorer' });
    expect(files.getAttribute('aria-expanded')).toBe('true');
    expect(workspaces.getAttribute('aria-expanded')).toBe('true');

    await userEvent.click(files);
    expect(files.getAttribute('aria-expanded')).toBe('false');
    expect(workspaces.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('File content').parentElement?.hidden).toBe(true);

    await userEvent.click(workspaces);
    expect(workspaces.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(files);
    expect(files.getAttribute('aria-expanded')).toBe('true');
  });

  it('reports both-open and single-open flex layouts', async () => {
    const { container } = render(
      <LeftSidebar isVisible onToggle={vi.fn()} workspaceContent={<div>Workspaces</div>}>
        <div>Files</div>
      </LeftSidebar>,
    );
    const sidebar = container.querySelector('.left-sidebar') as HTMLElement;
    expect(sidebar.getAttribute('data-accordion-layout')).toBe('both-open');
    expect(container.querySelector('.left-sidebar-section--files-open')).not.toBeNull();
    expect(container.querySelector('.left-sidebar-section--workspaces-open')).not.toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'File Explorer' }));
    expect(sidebar.getAttribute('data-accordion-layout')).toBe('workspaces-only');
    expect(container.querySelector('.left-sidebar-section--workspaces-open')?.classList.contains('left-sidebar-section--workspaces-open')).toBe(true);
  });

  it('supports controlled section state', async () => {
    const onFilesExpandedChange = vi.fn();
    render(
      <LeftSidebar
        isVisible
        onToggle={vi.fn()}
        filesExpanded={false}
        onFilesExpandedChange={onFilesExpandedChange}
      >
        Files
      </LeftSidebar>,
    );
    const files = screen.getByRole('button', { name: 'File Explorer' });
    await userEvent.click(files);
    expect(onFilesExpandedChange).toHaveBeenCalledWith(true);
    expect(files.getAttribute('aria-expanded')).toBe('false');
  });

  it('preserves the whole-sidebar toggle behavior', async () => {
    const onToggle = vi.fn();
    render(<LeftSidebar isVisible={false} onToggle={onToggle}>Files</LeftSidebar>);
    const toggle = screen.getByRole('button', { name: 'Expand sidebar' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

describe('WorkspaceExplorer', () => {
  it('renders every registered workspace and marks the current workspace', () => {
    render(<WorkspaceExplorer registry={registry} onSwitchWorkspace={vi.fn()} />);
    expect(screen.getAllByRole('option')).toHaveLength(8);
    const current = screen.getByRole('option', { name: /Workspace 1/ });
    expect(current.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Current')).toBeDefined();
    expect(screen.getByText('…/projects/workspace-8').getAttribute('title')).toBe('/home/developer/projects/workspace-8');
  });

  it('switches with the exact ID on click and keyboard activation', async () => {
    const onSwitchWorkspace = vi.fn();
    render(<WorkspaceExplorer registry={registry} onSwitchWorkspace={onSwitchWorkspace} />);
    const second = screen.getByRole('option', { name: /Workspace 2/ });
    await userEvent.click(second);
    expect(onSwitchWorkspace).toHaveBeenLastCalledWith('workspace-2');

    const third = screen.getByRole('option', { name: /Workspace 3/ });
    third.focus();
    await userEvent.keyboard('{Enter}');
    expect(onSwitchWorkspace).toHaveBeenLastCalledWith('workspace-3');
    await userEvent.keyboard(' ');
    expect(onSwitchWorkspace).toHaveBeenLastCalledWith('workspace-3');
    expect(onSwitchWorkspace).toHaveBeenCalledTimes(3);
  });

  it('disables switching while disabled, loading, or switching', () => {
    const onSwitchWorkspace = vi.fn();
    const { rerender } = render(
      <WorkspaceExplorer registry={registry} onSwitchWorkspace={onSwitchWorkspace} disabled />,
    );
    fireEvent.click(screen.getByRole('option', { name: /Workspace 2/ }));
    expect(onSwitchWorkspace).not.toHaveBeenCalled();

    rerender(<WorkspaceExplorer registry={registry} onSwitchWorkspace={onSwitchWorkspace} isLoading />);
    expect(screen.getByRole('status').textContent).toContain('Loading workspaces');
    expect((screen.getByRole('option', { name: /Workspace 2/ }) as HTMLButtonElement).disabled).toBe(true);

    rerender(
      <WorkspaceExplorer
        registry={registry}
        onSwitchWorkspace={onSwitchWorkspace}
        switchingWorkspaceId="workspace-2"
      />,
    );
    expect(screen.getByText('Switching…')).toBeDefined();
    expect(screen.getByRole('status').textContent).toContain('Switching workspace');
  });

  it('shows error and empty states', () => {
    const { rerender } = render(
      <WorkspaceExplorer registry={{ workspaces: [] }} error="Registry unavailable" />,
    );
    expect(screen.getByRole('alert').textContent).toBe('Registry unavailable');
    expect(screen.getByRole('status').textContent).toBe('No registered workspaces');

    rerender(<WorkspaceExplorer registry={null} />);
    expect(screen.getByRole('status').textContent).toBe('No registered workspaces');
  });

  it('offers an optional refresh action and disables it while loading', async () => {
    const onRefresh = vi.fn();
    const { rerender } = render(
      <WorkspaceExplorer registry={registry} onRefresh={onRefresh} onSwitchWorkspace={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);

    rerender(
      <WorkspaceExplorer registry={registry} onRefresh={onRefresh} onSwitchWorkspace={vi.fn()} isLoading />,
    );
    expect((screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
