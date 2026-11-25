import { randomUUID } from "node:crypto";
import { lstat, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

/** Serialized by WebDriver and evaluated read-only in the actual native WebView. */
export function nativeStartupDomObservation() {
  const explorer = document.querySelector('[role="tree"][aria-label="File Explorer"]');
  const rect = explorer?.getBoundingClientRect();
  const style = explorer ? getComputedStyle(explorer) : null;
  return {
    readyState: document.readyState,
    bootstrapPhase: document.documentElement.dataset.ideBootstrap ?? null,
    faults:
      (window as Window & { __IDE_STARTUP_OBSERVATION__?: unknown }).__IDE_STARTUP_OBSERVATION__ ??
      null,
    protocol: location.protocol,
    locationHost: location.host.slice(0, 256),
    rootChildren: document.getElementById("root")?.childElementCount ?? null,
    nativeBridgePresent: "__TAURI_INTERNALS__" in window,
    visibility: document.visibilityState,
    viewport: { width: innerWidth, height: innerHeight },
    explorer: explorer
      ? {
          children: explorer.querySelectorAll('[role="treeitem"]').length,
          width: rect?.width,
          height: rect?.height,
          display: style?.display,
          visibility: style?.visibility,
        }
      : null,
    scriptCount: document.scripts.length,
    resources: performance
      .getEntriesByType("resource")
      .slice(-16)
      .map((entry) => {
        const resource = entry as PerformanceResourceTiming;
        const url = new URL(entry.name, location.href);
        return {
          type: resource.initiatorType,
          asset: url.pathname.split("/").pop()?.slice(0, 100),
          durationMs: Math.round(resource.duration),
        };
      }),
    visibleText: (document.body?.innerText ?? "").slice(0, 2048),
  };
}

/** Private progress-format-compatible diagnostics: no readiness mutation or source write. */
export async function recordNativeStartupObservation({
  sandbox,
  outcome,
  applicationPid,
  capture,
}: {
  sandbox: string;
  outcome: "ready" | "timeout" | "close-timeout";
  applicationPid?: number;
  capture(): Promise<unknown>;
}): Promise<{ persisted: boolean; inspection: "available" | "unavailable"; observation: unknown }> {
  let observation: unknown = null;
  let inspection: "available" | "unavailable" = "unavailable";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    observation = await Promise.race([
      capture(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("startup inspection deadline")), 1000);
      }),
    ]);
    if (observation && typeof observation === "object") {
      const record = observation as Record<string, unknown>;
      if (typeof record.visibleText === "string")
        record.visibleText = record.visibleText.slice(0, 2048);
    }
    inspection = "available";
  } catch {
    observation = null;
  } finally {
    clearTimeout(timer);
  }
  try {
    const root = await realpath(sandbox);
    const directory = path.join(root, "artifacts");
    const metadata = await lstat(directory);
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      (await realpath(directory)) !== directory
    )
      throw new Error("unsafe startup artifact directory");
    const serialized = JSON.stringify({ outcome, applicationPid, inspection, observation });
    if (serialized.length > 12 * 1024) throw new Error("oversized startup observation");
    const redacted = serialized
      .replaceAll(sandbox, "<SANDBOX>")
      .replace(/\b(password|token|secret|api_key)=([^\s"\\]+)/gi, "$1=<REDACTED>")
      .replace(/\/(?:[^\s:'"\\]+\/?)+/g, "<PATH>");
    const safe = JSON.parse(redacted) as { observation: unknown };
    const filename = outcome === "close-timeout" ? "close-timeout" : "startup";
    await writeFile(path.join(directory, `${filename}-${randomUUID()}.json`), redacted + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    return { persisted: true, inspection, observation: safe.observation };
  } catch {
    return { persisted: false, inspection, observation: null };
  }
}
