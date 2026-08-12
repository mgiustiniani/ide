import { describe, expect, it, vi } from "vitest";

import {
  findIdePackagingSurvivors,
  IdePackagingStorySession,
} from "../story/support/ide-packaging";

describe("IDE packaging Story cleanup", () => {
  it("selects no processes when the artifact path is absent", () => {
    const unrelatedProcesses = [
      { pid: 1, cmdline: "/sbin/init" },
      { pid: 42, cmdline: "/usr/bin/kwin_wayland" },
      { pid: 84, cmdline: "/usr/lib/systemd/systemd --user" },
    ];

    expect(findIdePackagingSurvivors(null, unrelatedProcesses)).toEqual([]);
  });

  it("does not signal any process when disposal happens before artifact launch", async () => {
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    try {
      const session = new IdePackagingStorySession();
      await session.start();
      await session.dispose();

      expect(kill).not.toHaveBeenCalled();
    } finally {
      kill.mockRestore();
    }
  });
});
