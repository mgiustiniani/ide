// ---------------------------------------------------------------------------
// @ide/ui – PanelLayout Component Tests
// ---------------------------------------------------------------------------
// Tests that PanelLayout renders three panels, handles resize callbacks,
// and hides panels based on visibility.
// ---------------------------------------------------------------------------

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { AiAgentResponsePanel } from '../AiAgentResponsePanel/AiAgentResponsePanel';
import { PanelLayout } from '../PanelLayout/PanelLayout';
import type { AiAgentActivityEvent } from '../AiAgentResponsePanel/AiAgentResponsePanel';
import type { PanelLayout as PanelLayoutType } from '@ide/contracts';
import { DEFAULT_PANEL_LAYOUT } from '@ide/contracts';

// ── Helpers ─────────────────────────────────────────────────────────────

const defaultLayout: PanelLayoutType = {
  ...DEFAULT_PANEL_LAYOUT,
  visibility: {
    leftSidebar: { visible: true, active: false },
    mainArea: { visible: true, active: true },
    bottomPanel: { visible: true, active: false },
  },
  sizes: {
    leftSidebarWidth: 280,
    bottomPanelHeight: 250,
  },
  minSizes: {
    leftSidebarWidth: 160,
    bottomPanelHeight: 80,
  },
};

const responseActivities: AiAgentActivityEvent[] = [
  {
    id: 'read-started',
    type: 'tool_execution_start',
    title: 'Read source file',
    pluginName: 'filesystem',
    detail: 'Opening the response panel component.',
    timestamp: '10:02',
    status: 'running',
    agentId: 'frontend-agent',
    runId: 'run-123',
    changedFiles: [
      {
        path: 'packages/ui/src/components/AiAgentResponsePanel/AiAgentResponsePanel.tsx',
        status: 'modified',
      },
    ],
  },
  {
    id: 'tests-finished',
    type: 'test_complete',
    title: 'Focused UI tests passed',
    detail: 'Response panel tab coverage completed.',
    timestamp: '10:05',
    status: 'success',
    agentId: 'frontend-agent',
    runId: 'run-123',
    changedFiles: [
      {
        path: 'packages/ui/src/components/__tests__/PanelLayout.test.ts',
        status: 'added',
      },
    ],
  },
];

function renderAiAgentResponsePanel(): void {
  render(
    React.createElement(AiAgentResponsePanel, {
      latestResponse: 'The latest agent response is ready for review.',
      activities: responseActivities,
      isSending: false,
      onClose: vi.fn(),
    })
  );
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('PanelLayout', () => {
  it('should render left sidebar content', () => {
    render(
      React.createElement(PanelLayout, {
        leftSidebar: React.createElement('div', { 'data-testid': 'sidebar' }, 'Sidebar Content'),
        mainContent: React.createElement('div', { 'data-testid': 'main' }, 'Main Content'),
        bottomContent: React.createElement('div', { 'data-testid': 'bottom' }, 'Bottom Content'),
        layout: defaultLayout,
        onResizeLeft: vi.fn(),
        onResizeBottom: vi.fn(),
      })
    );

    expect(screen.getByTestId('sidebar')).toBeDefined();
  });

  it('should render main content', () => {
    render(
      React.createElement(PanelLayout, {
        leftSidebar: React.createElement('div', { 'data-testid': 'sidebar' }, 'Sidebar'),
        mainContent: React.createElement('div', { 'data-testid': 'main' }, 'Main Content'),
        bottomContent: React.createElement('div', { 'data-testid': 'bottom' }, 'Bottom'),
        layout: defaultLayout,
        onResizeLeft: vi.fn(),
        onResizeBottom: vi.fn(),
      })
    );

    expect(screen.getByTestId('main')).toBeDefined();
  });

  it('should render bottom panel content', () => {
    render(
      React.createElement(PanelLayout, {
        leftSidebar: React.createElement('div', { 'data-testid': 'sidebar' }, 'Sidebar'),
        mainContent: React.createElement('div', { 'data-testid': 'main' }, 'Main'),
        bottomContent: React.createElement('div', { 'data-testid': 'bottom' }, 'Bottom Content'),
        layout: defaultLayout,
        onResizeLeft: vi.fn(),
        onResizeBottom: vi.fn(),
      })
    );

    expect(screen.getByTestId('bottom')).toBeDefined();
  });

  it('should show the bottom terminal panel by default without overlaying the editor', () => {
    const { container } = render(
      React.createElement(PanelLayout, {
        leftSidebar: React.createElement('div', { 'data-testid': 'sidebar' }, 'Sidebar'),
        mainContent: React.createElement('div', { 'data-testid': 'main' }, 'Main Editor'),
        bottomContent: React.createElement('div', { 'data-testid': 'terminal' }, 'Terminal'),
        layout: defaultLayout,
        onResizeLeft: vi.fn(),
        onResizeBottom: vi.fn(),
      })
    );

    const workspace = container.querySelector('.ide-workspace') as HTMLDivElement;
    const mainEditorPane = container.querySelector('.ide-main-editor-pane') as HTMLElement;
    const bottomPanel = container.querySelector('.ide-bottom-panel') as HTMLDivElement;
    const horizontalResizeHandle = screen.getByRole('separator', { name: 'Resize bottom panel' });

    expect(screen.getByTestId('main')).toBeDefined();
    expect(screen.getByTestId('terminal')).toBeDefined();
    expect(bottomPanel.hidden).toBe(false);
    expect(bottomPanel.getAttribute('aria-hidden')).toBe('false');
    expect(bottomPanel.style.height).toBe('250px');
    expect(bottomPanel.style.minHeight).toBe('80px');
    expect(bottomPanel.classList.contains('ide-bottom-panel')).toBe(true);
    expect(bottomPanel.classList.contains('absolute')).toBe(false);
    expect(bottomPanel.classList.contains('fixed')).toBe(false);
    expect(mainEditorPane.classList.contains('flex-1')).toBe(true);
    expect(mainEditorPane.classList.contains('min-h-0')).toBe(true);
    expect(mainEditorPane.classList.contains('overflow-hidden')).toBe(true);
    expect(workspace.nextElementSibling).toBe(horizontalResizeHandle);
    expect(horizontalResizeHandle.nextElementSibling).toBe(bottomPanel);
  });

  it('should render the optional right sidebar with fullscreen-friendly default sizing', () => {
    render(
      React.createElement(PanelLayout, {
        leftSidebar: React.createElement('div', { 'data-testid': 'sidebar' }, 'Sidebar'),
        mainContent: React.createElement('div', { 'data-testid': 'main' }, 'Main Editor'),
        bottomContent: React.createElement('div', { 'data-testid': 'terminal' }, 'Terminal'),
        rightSidebarContent: React.createElement('div', { 'data-testid': 'right-sidebar-content' }, 'AI Agent'),
        layout: defaultLayout,
        onResizeLeft: vi.fn(),
        onResizeBottom: vi.fn(),
      })
    );

    const rightSidebar = screen.getByRole('complementary', { name: 'Secondary side panel' }) as HTMLElement;

    expect(screen.getByTestId('right-sidebar-content')).toBeDefined();
    expect(rightSidebar.style.width).toBe('420px');
    expect(rightSidebar.style.minWidth).toBe('320px');
    expect(rightSidebar.style.maxWidth).toBe('100%');
    expect(rightSidebar.style.flexShrink).toBe('1');
    expect(rightSidebar.classList.contains('min-w-0')).toBe(true);
    expect(rightSidebar.classList.contains('max-w-full')).toBe(true);
  });

  it('should resize the bottom panel taller when dragged upward and shorter when dragged downward', () => {
    const onResizeBottom = vi.fn();

    render(
      React.createElement(PanelLayout, {
        leftSidebar: React.createElement('div', { 'data-testid': 'sidebar' }, 'Sidebar'),
        mainContent: React.createElement('div', { 'data-testid': 'main' }, 'Main Editor'),
        bottomContent: React.createElement('div', { 'data-testid': 'terminal' }, 'Terminal'),
        layout: defaultLayout,
        onResizeLeft: vi.fn(),
        onResizeBottom,
      })
    );

    const horizontalResizeHandle = screen.getByRole('separator', { name: 'Resize bottom panel' });

    fireEvent.mouseDown(horizontalResizeHandle, { clientY: 400 });
    fireEvent.mouseMove(document, { clientY: 350 });
    expect(onResizeBottom).toHaveBeenLastCalledWith(300);
    fireEvent.mouseUp(document);

    fireEvent.mouseDown(horizontalResizeHandle, { clientY: 400 });
    fireEvent.mouseMove(document, { clientY: 450 });
    expect(onResizeBottom).toHaveBeenLastCalledWith(200);
    fireEvent.mouseUp(document);
  });

  it('should hide left sidebar when not visible', () => {
    const hiddenLayout = {
      ...defaultLayout,
      visibility: {
        ...defaultLayout.visibility,
        leftSidebar: { visible: false, active: false },
      },
    };

    render(
      React.createElement(PanelLayout, {
        leftSidebar: React.createElement('div', { 'data-testid': 'sidebar' }, 'Sidebar Content'),
        mainContent: React.createElement('div', { 'data-testid': 'main' }, 'Main'),
        bottomContent: React.createElement('div', { 'data-testid': 'bottom' }, 'Bottom'),
        layout: hiddenLayout,
        onResizeLeft: vi.fn(),
        onResizeBottom: vi.fn(),
      })
    );

    expect(screen.queryByText('Sidebar Content')).toBeNull();
  });

  it('should hide bottom panel when not visible', () => {
    const hiddenLayout = {
      ...defaultLayout,
      visibility: {
        ...defaultLayout.visibility,
        bottomPanel: { visible: false, active: false },
      },
    };

    render(
      React.createElement(PanelLayout, {
        leftSidebar: React.createElement('div', { 'data-testid': 'sidebar' }, 'Sidebar'),
        mainContent: React.createElement('div', { 'data-testid': 'main' }, 'Main'),
        bottomContent: React.createElement('div', { 'data-testid': 'bottom' }, 'Bottom Content'),
        layout: hiddenLayout,
        onResizeLeft: vi.fn(),
        onResizeBottom: vi.fn(),
      })
    );

    expect(screen.queryByText('Bottom Content')).toBeNull();
  });

  it('should always render main content regardless of visibility', () => {
    const layout = {
      ...defaultLayout,
      visibility: {
        leftSidebar: { visible: false, active: false },
        mainArea: { visible: true, active: true },
        bottomPanel: { visible: false, active: false },
      },
    };

    render(
      React.createElement(PanelLayout, {
        leftSidebar: React.createElement('div', null, 'Sidebar'),
        mainContent: React.createElement('div', { 'data-testid': 'main' }, 'Main Content'),
        bottomContent: React.createElement('div', null, 'Bottom'),
        layout,
        onResizeLeft: vi.fn(),
        onResizeBottom: vi.fn(),
      })
    );

    expect(screen.getByTestId('main')).toBeDefined();
  });
});

describe('AiAgentResponsePanel tabs', () => {
  it('shows the latest response on the Response tab by default', () => {
    renderAiAgentResponsePanel();

    const responseTab = screen.getByRole('tab', { name: 'Response' });
    const responsePanel = screen.getByRole('tabpanel', { name: 'Response' });

    expect(responseTab.getAttribute('aria-selected')).toBe('true');
    expect(within(responsePanel).getByText('Latest response')).toBeDefined();
    expect(within(responsePanel).getByText('The latest agent response is ready for review.')).toBeDefined();
  });

  it('selects the Activity tab and shows activity items', () => {
    renderAiAgentResponsePanel();

    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));

    const activityTab = screen.getByRole('tab', { name: 'Activity' });
    const activityPanel = screen.getByRole('tabpanel', { name: 'Activity' });

    expect(activityTab.getAttribute('aria-selected')).toBe('true');
    expect(within(activityPanel).getByRole('list', { name: 'AI Agent activity' })).toBeDefined();
    expect(within(activityPanel).getByText('Read source file')).toBeDefined();
    expect(within(activityPanel).getByText('Opening the response panel component.')).toBeDefined();
  });

  it('selects the Agents tab and summarizes the provided agent', () => {
    renderAiAgentResponsePanel();

    fireEvent.click(screen.getByRole('tab', { name: 'Agents' }));

    const agentsPanel = screen.getByRole('tabpanel', { name: 'Agents' });
    const agentsList = within(agentsPanel).getByRole('list', { name: 'AI Agent activity by agent' });

    expect(within(agentsList).getByText('frontend-agent')).toBeDefined();
    expect(within(agentsList).getByText('2 events')).toBeDefined();
    expect(within(agentsList).getByText('run-123')).toBeDefined();
  });

  it('selects the Changes tab and summarizes changed files', () => {
    renderAiAgentResponsePanel();

    fireEvent.click(screen.getByRole('tab', { name: 'Changes' }));

    const changesPanel = screen.getByRole('tabpanel', { name: 'Changes' });
    const changesList = within(changesPanel).getByRole('list', { name: 'AI Agent changed files' });

    expect(within(changesList).getByText('packages/ui/src/components/AiAgentResponsePanel/AiAgentResponsePanel.tsx')).toBeDefined();
    expect(within(changesList).getByText('modified')).toBeDefined();
    expect(within(changesList).getByText('packages/ui/src/components/__tests__/PanelLayout.test.ts')).toBeDefined();
    expect(within(changesList).getByText('added')).toBeDefined();
  });
});
