import { describe, expect, it } from 'vitest';

import { detectDocumentKind } from '../document';

describe('detectDocumentKind', () => {
  it('detects Markdown documents', () => {
    expect(detectDocumentKind('README.md')).toBe('markdown');
    expect(detectDocumentKind('/docs/Guide.MARKDOWN')).toBe('markdown');
  });

  it('detects AsciiDoc documents', () => {
    expect(detectDocumentKind('manual.adoc')).toBe('asciidoc');
    expect(detectDocumentKind('/docs/Manual.ASCIIDOC?version=1')).toBe('asciidoc');
  });

  it('returns unknown for unsupported files', () => {
    expect(detectDocumentKind('src/main.ts')).toBe('unknown');
    expect(detectDocumentKind('README')).toBe('unknown');
  });
});
