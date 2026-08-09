import { describe, expectTypeOf, it } from "vitest";

import type {
  PiWorkspaceAgentAttachment,
  PiWorkspaceAgentProcessState,
  PiWorkspaceAgentSessionSummary,
} from "../index";

describe("Pi workspace agent public API", () => {
  it("exports the exact rootless retained-session summary shape", () => {
    expectTypeOf<PiWorkspaceAgentSessionSummary>().toEqualTypeOf<{
      workspaceId: string;
      workspaceName: string;
      sessionId: string;
      processState: PiWorkspaceAgentProcessState;
      processGeneration: number;
      lastActivityAt: string;
      attachedViewCount: number;
    }>();
    expectTypeOf<PiWorkspaceAgentAttachment["sessions"]>().toEqualTypeOf<
      PiWorkspaceAgentSessionSummary[]
    >();
  });
});
