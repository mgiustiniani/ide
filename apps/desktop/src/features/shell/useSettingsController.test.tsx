import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSettingsController, useSettingsOpenCoordinator } from "./useSettingsController";

describe("useSettingsController", () => {
  it("opens and closes settings idempotently", () => {
    const { result } = renderHook(() => useSettingsController());

    expect(result.current.isOpen).toBe(false);
    act(() => result.current.open());
    expect(result.current.isOpen).toBe(true);
    act(() => result.current.open());
    expect(result.current.isOpen).toBe(true);
    act(() => result.current.close());
    expect(result.current.isOpen).toBe(false);
  });
});

describe("useSettingsOpenCoordinator", () => {
  it("opens settings and requests a refresh from every independently owned section", () => {
    const open = vi.fn();
    const loadAiAgentConfiguration = vi.fn(async () => undefined);
    const loadAiAgentCommands = vi.fn(async () => undefined);
    const loadWorkspaceMetadata = vi.fn(async () => undefined);
    const refreshJavaLanguage = vi.fn(async () => undefined);
    const refreshRefactorKitStatus = vi.fn(async () => undefined);
    const refreshXcom2Setup = vi.fn(async () => undefined);
    const { result } = renderHook(() =>
      useSettingsOpenCoordinator({
        open,
        loadAiAgentConfiguration,
        loadAiAgentCommands,
        loadWorkspaceMetadata,
        refreshJavaLanguage,
        refreshRefactorKitStatus,
        refreshXcom2Setup,
      }),
    );

    act(() => result.current());

    expect(open).toHaveBeenCalledOnce();
    expect(loadAiAgentConfiguration).toHaveBeenCalledOnce();
    expect(loadAiAgentCommands).toHaveBeenCalledOnce();
    expect(loadWorkspaceMetadata).toHaveBeenCalledOnce();
    expect(refreshJavaLanguage).toHaveBeenCalledOnce();
    expect(refreshRefactorKitStatus).toHaveBeenCalledOnce();
    expect(refreshXcom2Setup).toHaveBeenCalledOnce();
  });
});
