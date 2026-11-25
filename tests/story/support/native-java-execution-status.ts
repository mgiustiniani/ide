import type { NativeDesktopApplication } from "./native-desktop-application.js";

/** Observe the current execution status independently of console text and panel layout. */
export async function readNativeJavaExecutionStatuses(
  browser: ReturnType<NativeDesktopApplication["browser"]>,
): Promise<string[]> {
  return browser.execute(() => Array.from(
    document.querySelector('section[aria-label="Java execution"]')?.querySelectorAll('[role="status"]') ?? [],
    (element) => element.textContent?.trim() ?? "",
  ));
}
