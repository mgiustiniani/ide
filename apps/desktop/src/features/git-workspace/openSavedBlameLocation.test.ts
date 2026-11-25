import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openSavedBlameLocation } from "./openSavedBlameLocation";

beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => vi.unstubAllGlobals());
const text = "class Main {\r\n  void run() {}\r\n}\r\n";
async function fixture() {
  const bytes = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  const fingerprint = Buffer.from(bytes).toString("hex");
  const state = { current: true, text, lifetime: Symbol(), dirty: false, active: true };
  const dependencies = {
    isCurrent: () => state.current,
    openFile: vi.fn(async () => true),
    readBuffer: vi.fn(() => ({ ...state })),
    reveal: vi.fn((_path: string, _line: number, current: () => boolean) => current()),
  };
  return { dependencies, state, fingerprint, bytes };
}
it("reveals the exact clean CRLF Java source without replacing or saving its text", async () => {
  const f = await fixture();
  expect(await openSavedBlameLocation("src/Main.java", 2, f.fingerprint, f.dependencies)).toBe(
    true,
  );
  expect(f.dependencies.reveal).toHaveBeenCalledWith("src/Main.java", 2, expect.any(Function));
  expect(f.state.text).toBe(text);
});
it.each(["dirty", "retired", "path", "line", "fingerprint"])(
  "refuses %s before opening",
  async (kind) => {
    const f = await fixture();
    if (kind === "dirty") f.state.dirty = true;
    if (kind === "retired") f.state.current = false;
    expect(
      await openSavedBlameLocation(
        kind === "path" ? "../Main.java" : "Main.java",
        kind === "line" ? 0 : 2,
        kind === "fingerprint" ? "invalid" : f.fingerprint,
        f.dependencies,
      ),
    ).toBe(false);
    expect(f.dependencies.openFile).not.toHaveBeenCalled();
    expect(f.dependencies.reveal).not.toHaveBeenCalled();
  },
);
it.each(["changed", "line", "bare-cr", "oversized", "inactive", "open-failed"])(
  "does not reveal %s source",
  async (kind) => {
    const f = await fixture();
    if (kind === "changed") f.state.text += "// new saved bytes";
    if (kind === "bare-cr") f.state.text = "class Main {}\rclass Other {}";
    if (kind === "oversized") f.state.text = "x".repeat(512 * 1024 + 1);
    if (kind === "inactive") f.state.active = false;
    if (kind === "open-failed") f.dependencies.openFile.mockResolvedValueOnce(false);
    expect(
      await openSavedBlameLocation(
        "Main.java",
        kind === "line" ? 20 : 2,
        f.fingerprint,
        f.dependencies,
      ),
    ).toBe(false);
    expect(f.dependencies.reveal).not.toHaveBeenCalled();
  },
);
it.each(["dirty", "text", "lifetime", "active", "workspace"])(
  "rejects %s changes while hashing",
  async (kind) => {
    const f = await fixture();
    let finish!: (bytes: ArrayBuffer) => void;
    const pending = new Promise<ArrayBuffer>((resolve) => {
      finish = resolve;
    });
    const digest = vi.fn(() => pending);
    vi.stubGlobal("crypto", { subtle: { digest } });
    const opening = openSavedBlameLocation("Main.java", 2, f.fingerprint, f.dependencies);
    await Promise.resolve();
    expect(digest).toHaveBeenCalledOnce();
    if (kind === "dirty") f.state.dirty = true;
    if (kind === "text") f.state.text += "// changed";
    if (kind === "lifetime") f.state.lifetime = Symbol();
    if (kind === "active") f.state.active = false;
    if (kind === "workspace") f.state.current = false;
    finish(f.bytes);
    expect(await opening).toBe(false);
    expect(f.dependencies.reveal).not.toHaveBeenCalled();
  },
);
