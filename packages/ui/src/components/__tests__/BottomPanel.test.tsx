import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BottomPanel } from '../PanelLayout/BottomPanel';

describe('BottomPanel', () => {
  it('renders a compact accessible, horizontally scrollable contribution header', () => {
    const onTabActivate = vi.fn();
    render(
      <BottomPanel
        tabs={[
          { id: 'terminal', label: 'Terminal', isActive: true, icon: <span data-testid="terminal-icon">T</span>, scope: 'core', title: 'Open terminal' },
          { id: 'problems', label: 'Problems', isActive: false, count: 3, scope: 'project' },
          { id: 'build', label: 'Build', isActive: false, badge: '!', scope: 'project', disabled: true },
        ]}
        actions={<button type="button">Hide panel</button>}
        onTabActivate={onTabActivate}
      >
        <div>Terminal content</div>
      </BottomPanel>,
    );

    const tablist = screen.getByRole('tablist', { name: 'Tool windows' });
    expect(tablist.className).toContain('overflow-x-auto');
    expect(screen.getByTestId('terminal-icon')).toBeDefined();
    expect(screen.getByRole('tab', { name: 'Problems 3' })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'Build !' }).getAttribute('data-scope')).toBe('project');
    expect((screen.getByRole('tab', { name: 'Build !' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('tab', { name: 'Terminal' }).getAttribute('title')).toBe('Open terminal');
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe('bottom-panel-tab-terminal');
    expect(screen.getByLabelText('Tool window actions')).toBeDefined();

    fireEvent.click(screen.getByRole('tab', { name: 'Build !' }));
    expect(onTabActivate).not.toHaveBeenCalled();
  });

  it('renders dynamic Problems count and highest-severity metadata without inventing a tab', () => {
    const { rerender } = render(
      <BottomPanel
        tabs={[{ id: 'problems', label: 'Problems', isActive: true, scope: 'project', badge: { count: 3, severity: 'error', ariaLabel: '3 problems, 2 errors and 1 warning' } }]}
        onTabActivate={vi.fn()}
      >
        Problems content
      </BottomPanel>,
    );

    const tab = screen.getByRole('tab', { name: 'Problems 3 problems, 2 errors and 1 warning' });
    expect(tab.querySelector('[data-severity="error"]')?.textContent).toBe('3');

    rerender(
      <BottomPanel
        tabs={[{ id: 'problems', label: 'Problems', isActive: true, scope: 'project', badge: { count: 0, ariaLabel: '0 problems' } }]}
        onTabActivate={vi.fn()}
      >
        Empty
      </BottomPanel>,
    );
    expect(screen.getByRole('tab', { name: 'Problems 0 problems' }).textContent).toContain('0');
  });

  it('supports arrow, Home, and End keyboard activation while skipping disabled tabs', () => {
    const onTabActivate = vi.fn();
    render(
      <BottomPanel
        tabs={[
          { id: 'terminal', label: 'Terminal', isActive: true },
          { id: 'disabled', label: 'Disabled', isActive: false, disabled: true },
          { id: 'problems', label: 'Problems', isActive: false },
        ]}
        onTabActivate={onTabActivate}
      >
        Content
      </BottomPanel>,
    );

    const terminal = screen.getByRole('tab', { name: 'Terminal' });
    const problems = screen.getByRole('tab', { name: 'Problems' });
    fireEvent.keyDown(terminal, { key: 'ArrowRight' });
    expect(problems).toBe(document.activeElement);
    expect(onTabActivate).toHaveBeenLastCalledWith('problems');

    fireEvent.keyDown(problems, { key: 'ArrowRight' });
    expect(terminal).toBe(document.activeElement);
    expect(onTabActivate).toHaveBeenLastCalledWith('terminal');

    fireEvent.keyDown(terminal, { key: 'End' });
    expect(onTabActivate).toHaveBeenLastCalledWith('problems');
    fireEvent.keyDown(problems, { key: 'Home' });
    expect(onTabActivate).toHaveBeenLastCalledWith('terminal');
  });
});
