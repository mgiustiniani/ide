import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { JavaProjectTextSearchPanel } from "../JavaProjectTextSearchPanel";

describe("JavaProjectTextSearchPanel", () => {
  it("focuses the query for a requested shortcut and reports the request as handled", () => {
    const onFocusRequestHandled = vi.fn();
    render(
      <JavaProjectTextSearchPanel
        query=""
        caseSensitive={false}
        matches={[]}
        scannedFiles={0}
        skippedFiles={0}
        searchedDraftFiles={0}
        skippedDraftFiles={0}
        truncated={false}
        hasSearched={false}
        isBusy={false}
        focusRequest={7}
        onQueryChange={vi.fn()}
        onCaseSensitiveChange={vi.fn()}
        onSearch={vi.fn()}
        onClear={vi.fn()}
        onFocusRequestHandled={onFocusRequestHandled}
      />,
    );

    expect(document.activeElement).toBe(screen.getByPlaceholderText("Text to find in project"));
    expect(onFocusRequestHandled).toHaveBeenCalledWith(7);
  });

  it("submits literal searches and opens a selected source line", () => {
    const onSearch = vi.fn();
    const onResultSelect = vi.fn();
    render(
      <JavaProjectTextSearchPanel
        query="Widget"
        caseSensitive
        matches={[
          { path: "app/src/main/java/Widget.java", line: 9, column: 7, snippet: "class Widget {}" },
        ]}
        scannedFiles={6}
        skippedFiles={0}
        searchedDraftFiles={1}
        skippedDraftFiles={0}
        truncated={false}
        hasSearched
        isBusy={false}
        onQueryChange={vi.fn()}
        onCaseSensitiveChange={vi.fn()}
        onSearch={onSearch}
        onClear={vi.fn()}
        onResultSelect={onResultSelect}
      />,
    );

    fireEvent.submit(screen.getByRole("form", { name: "Find in Java project" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Open app/src/main/java/Widget.java at line 9, column 7",
      }),
    );
    expect(onSearch).toHaveBeenCalledOnce();
    expect(onResultSelect).toHaveBeenCalledWith({
      path: "app/src/main/java/Widget.java",
      line: 9,
      column: 7,
      snippet: "class Widget {}",
    });
    expect(screen.getByText(/open unsaved text buffers/)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("1 unsaved text buffer also searched");
  });

  it("labels capped search results as incomplete", () => {
    render(
      <JavaProjectTextSearchPanel
        query="needle"
        caseSensitive={false}
        matches={[]}
        scannedFiles={200}
        skippedFiles={3}
        searchedDraftFiles={0}
        skippedDraftFiles={0}
        truncated
        hasSearched
        isBusy={false}
        onQueryChange={vi.fn()}
        onCaseSensitiveChange={vi.fn()}
        onSearch={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("may be incomplete");
    expect(screen.getByRole("status").textContent).toContain("3 project text files were skipped");
  });

  it("marks skipped files as potentially incomplete even without a traversal limit", () => {
    render(
      <JavaProjectTextSearchPanel
        query="needle"
        caseSensitive={false}
        matches={[]}
        scannedFiles={1}
        skippedFiles={1}
        searchedDraftFiles={0}
        skippedDraftFiles={0}
        truncated={false}
        hasSearched
        isBusy={false}
        onQueryChange={vi.fn()}
        onCaseSensitiveChange={vi.fn()}
        onSearch={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("1 project text file was skipped");
    expect(screen.getByRole("status").textContent).toContain("Results may be incomplete");
  });

  it("reports a completed search with no Java matches", () => {
    render(
      <JavaProjectTextSearchPanel
        query="not-present"
        caseSensitive={false}
        matches={[]}
        scannedFiles={0}
        skippedFiles={0}
        searchedDraftFiles={0}
        skippedDraftFiles={0}
        truncated={false}
        hasSearched
        isBusy={false}
        onQueryChange={vi.fn()}
        onCaseSensitiveChange={vi.fn()}
        onSearch={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain(
      "0 matches; scanned 0 saved project text files",
    );
  });

  it("reports draft buffers that are skipped by their safety limits", () => {
    render(
      <JavaProjectTextSearchPanel
        query="needle"
        caseSensitive={false}
        matches={[]}
        scannedFiles={0}
        skippedFiles={0}
        searchedDraftFiles={1}
        skippedDraftFiles={2}
        truncated
        hasSearched
        isBusy={false}
        onQueryChange={vi.fn()}
        onCaseSensitiveChange={vi.fn()}
        onSearch={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("1 unsaved text buffer also searched");
    expect(screen.getByRole("status").textContent).toContain("2 unsaved text buffers were skipped");
    expect(screen.getByRole("status").textContent).toContain("may be incomplete");
  });
});
