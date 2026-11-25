import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceEditorPreferences } from "./useWorkspaceEditorPreferences";

beforeEach(() => localStorage.clear());

describe("useWorkspaceEditorPreferences", () => {
  it("keeps Java typing formatting opt-in and isolated to its workspace", () => {
    const h = renderHook(({ id }) => useWorkspaceEditorPreferences(id), { initialProps: { id: "one" } });
    expect(h.result.current.preferences.formatJavaOnType).toBeUndefined();
    act(() => { h.result.current.save({ tabSize: 2, insertSpaces: true, formatJavaOnType: true }); });
    expect(h.result.current.preferences.formatJavaOnType).toBe(true);
    h.rerender({ id: "two" });
    expect(h.result.current.preferences.formatJavaOnType).toBeUndefined();
    h.rerender({ id: "one" });
    expect(h.result.current.preferences.formatJavaOnType).toBe(true);
  });
  it("persists indentation per workspace and reloads it after switching", () => {
    const { result, rerender } = renderHook(
      ({ workspaceId }: { workspaceId: string | null }) =>
        useWorkspaceEditorPreferences(workspaceId),
      { initialProps: { workspaceId: "workspace-one" } },
    );

    expect(result.current.preferences).toEqual({ tabSize: 2, insertSpaces: true });
    act(() => expect(result.current.save({ tabSize: 4, insertSpaces: false })).toBe(true));
    expect(result.current.preferences).toEqual({ tabSize: 4, insertSpaces: false });

    rerender({ workspaceId: "workspace-two" });
    expect(result.current.preferences).toEqual({ tabSize: 2, insertSpaces: true });
    act(() => expect(result.current.save({ tabSize: 8, insertSpaces: true })).toBe(true));

    rerender({ workspaceId: "workspace-one" });
    expect(result.current.preferences).toEqual({ tabSize: 4, insertSpaces: false });
  });

  it("preserves malformed stored data until an explicit valid save", () => {
    localStorage.setItem("ide.workspace.editor-preferences.v1.workspace-one", "broken data");
    const { result } = renderHook(() => useWorkspaceEditorPreferences("workspace-one"));

    expect(result.current.preferences).toEqual({ tabSize: 2, insertSpaces: true });
    expect(result.current.error).toMatch(/invalid/u);
    expect(localStorage.getItem("ide.workspace.editor-preferences.v1.workspace-one")).toBe(
      "broken data",
    );

    act(() => expect(result.current.save({ tabSize: 3, insertSpaces: true })).toBe(true));
    expect(result.current.preferences).toEqual({ tabSize: 3, insertSpaces: true });
    expect(result.current.error).toBeNull();
  });

  it("loads legacy preferences and persists a workspace Eclipse formatter profile", () => {
    localStorage.setItem(
      "ide.workspace.editor-preferences.v1.workspace-one",
      JSON.stringify({ version: 1, preferences: { tabSize: 4, insertSpaces: false } }),
    );
    const { result } = renderHook(() => useWorkspaceEditorPreferences("workspace-one"));
    expect(result.current.preferences).toEqual({ tabSize: 4, insertSpaces: false });

    const preferences = {
      tabSize: 4,
      insertSpaces: false,
      javaFormatterProfile: { path: "config/format.xml", profileName: "Team Java" },
    };
    act(() => expect(result.current.save(preferences)).toBe(true));
    expect(result.current.preferences).toEqual(preferences);
    expect(
      JSON.parse(localStorage.getItem("ide.workspace.editor-preferences.v1.workspace-one")!),
    ).toEqual({
      version: 1,
      preferences,
    });
  });

  it("rejects formatter profiles outside the workspace-relative XML contract", () => {
    const { result } = renderHook(() => useWorkspaceEditorPreferences("workspace-one"));
    act(() =>
      expect(
        result.current.save({
          tabSize: 4,
          insertSpaces: true,
          javaFormatterProfile: { path: "../format.xml", profileName: "Team Java" },
        }),
      ).toBe(false),
    );
    expect(result.current.error).toMatch(/invalid/u);
  });

  it("reports storage failures without changing the in-memory value", () => {
    const { result } = renderHook(() => useWorkspaceEditorPreferences("workspace-one"));
    vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => {
      throw new Error("storage denied");
    });

    act(() => expect(result.current.save({ tabSize: 4, insertSpaces: true })).toBe(false));
    expect(result.current.preferences).toEqual({ tabSize: 2, insertSpaces: true });
    expect(result.current.error).toMatch(/could not be saved/u);
  });
});
