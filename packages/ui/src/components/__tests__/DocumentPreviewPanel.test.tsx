// ---------------------------------------------------------------------------
// @ide/ui – DocumentPreviewPanel Component Tests
// ---------------------------------------------------------------------------

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DocumentPreviewPanel } from '../DocumentPreviewPanel/DocumentPreviewPanel';

describe('DocumentPreviewPanel', () => {
  it('renders a Markdown preview with safe React nodes and a secure external link', () => {
    render(
      React.createElement(DocumentPreviewPanel, {
        filePath: '/workspace/docs/README.md',
        kind: 'markdown',
        content: [
          '# Project **Docs**',
          '',
          'Read the [guide](https://example.com/docs) with `inline code` and *emphasis*.',
          '',
          '- First item',
          '- Second item',
          '',
          '```ts',
          'const value = 42;',
          '```',
        ].join('\n'),
      }),
    );

    expect(screen.getByRole('region', { name: 'Document preview' })).toBeDefined();
    expect(screen.getByText('README.md')).toBeDefined();
    expect(screen.getByText('Markdown')).toBeDefined();
    expect(screen.getByRole('heading', { level: 1, name: 'Project Docs' })).toBeDefined();
    expect(screen.getByText('inline code').tagName).toBe('CODE');
    expect(screen.getByText('emphasis').tagName).toBe('EM');
    expect(screen.getByRole('list')).toBeDefined();
    expect(screen.getByText('First item')).toBeDefined();
    expect(screen.getByText('const value = 42;')).toBeDefined();

    const link = screen.getByRole('link', { name: 'guide' });
    expect(link.getAttribute('href')).toBe('https://example.com/docs');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.getAttribute('rel')).toContain('noreferrer');
  });

  it('renders unsafe Markdown links as non-clickable text', () => {
    render(
      React.createElement(DocumentPreviewPanel, {
        filePath: 'unsafe.md',
        kind: 'markdown',
        content: 'Do not run [bad link](javascript:alert(1)).',
      }),
    );

    expect(screen.getByText('bad link')).toBeDefined();
    expect(screen.queryByRole('link', { name: 'bad link' })).toBeNull();
  });

  it('renders basic AsciiDoc headings, lists, source blocks, monospace, and bold text', () => {
    render(
      React.createElement(DocumentPreviewPanel, {
        filePath: '/workspace/docs/guide.adoc',
        kind: 'asciidoc',
        content: [
          '= Guide *Title*',
          '',
          'Use `monospace` and *bold text*.',
          '',
          '* Alpha',
          '* Beta',
          '',
          '[source,ts]',
          '----',
          'export const ok = true;',
          '----',
        ].join('\n'),
      }),
    );

    expect(screen.getByText('guide.adoc')).toBeDefined();
    expect(screen.getByText('AsciiDoc')).toBeDefined();
    expect(screen.getByRole('heading', { level: 1, name: 'Guide Title' })).toBeDefined();
    expect(screen.getByText('monospace').tagName).toBe('CODE');
    expect(screen.getByText('bold text').tagName).toBe('STRONG');

    const list = screen.getByRole('list');
    expect(within(list).getByText('Alpha')).toBeDefined();
    expect(within(list).getByText('Beta')).toBeDefined();
    expect(screen.getByText('export const ok = true;')).toBeDefined();
  });

  it('renders unknown documents as plain text and calls the optional close handler', () => {
    const onClose = vi.fn();

    render(
      React.createElement(DocumentPreviewPanel, {
        filePath: 'notes.txt',
        kind: 'unknown',
        content: 'plain <b>text</b>',
        onClose,
      }),
    );

    expect(screen.getByText('Plain text')).toBeDefined();
    expect(screen.getByText('plain <b>text</b>')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Close document preview' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
