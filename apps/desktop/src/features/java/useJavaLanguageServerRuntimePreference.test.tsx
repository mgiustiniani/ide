import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useJavaLanguageServerRuntimePreference } from "./useJavaLanguageServerRuntimePreference";

beforeEach(() => localStorage.clear());

describe("useJavaLanguageServerRuntimePreference", () => {
  it("persists a global JDT LS JDK separately from project settings", () => {
    const { result, rerender } = renderHook(() => useJavaLanguageServerRuntimePreference());

    expect(result.current.serverJdkHome).toBe("");
    act(() => expect(result.current.save("/jdk-25")).toBe(true));
    expect(result.current.serverJdkHome).toBe("/jdk-25");
    expect(JSON.parse(localStorage.getItem("ide.java.language-server-runtime.v1")!)).toEqual({
      version: 1,
      serverJdkHome: "/jdk-25",
    });

    rerender();
    expect(result.current.serverJdkHome).toBe("/jdk-25");
  });

  it("preserves malformed stored data until an explicit valid save", () => {
    localStorage.setItem("ide.java.language-server-runtime.v1", "broken data");
    const { result } = renderHook(() => useJavaLanguageServerRuntimePreference());

    expect(result.current.serverJdkHome).toBe("");
    expect(result.current.error).toMatch(/invalid/u);
    expect(localStorage.getItem("ide.java.language-server-runtime.v1")).toBe("broken data");

    act(() => expect(result.current.save("")).toBe(true));
    expect(result.current.serverJdkHome).toBe("");
    expect(result.current.error).toBeNull();
  });

  it("rejects untrimmed paths and control characters without replacing the saved value", () => {
    const { result } = renderHook(() => useJavaLanguageServerRuntimePreference());
    act(() => expect(result.current.save("/jdk-25")).toBe(true));

    act(() => expect(result.current.save(" /jdk-21 ")).toBe(false));
    expect(result.current.serverJdkHome).toBe("/jdk-25");
    expect(result.current.error).toMatch(/absolute JDK home/u);

    act(() => expect(result.current.save("/jdk-21\n")).toBe(false));
    expect(result.current.serverJdkHome).toBe("/jdk-25");
    act(() => expect(result.current.save("jdk-21")).toBe(false));
    expect(result.current.serverJdkHome).toBe("/jdk-25");
  });

  it("reports storage failures without changing the in-memory setting", () => {
    const { result } = renderHook(() => useJavaLanguageServerRuntimePreference());
    vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => {
      throw new Error("storage denied");
    });

    act(() => expect(result.current.save("/jdk-25")).toBe(false));
    expect(result.current.serverJdkHome).toBe("");
    expect(result.current.error).toMatch(/could not be saved/u);
  });
});
