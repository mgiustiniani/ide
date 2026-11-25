import type { ChildProcess } from "node:child_process";

/** Signal only the isolated process group created when the native driver was spawned. */
export function signalDriverProcessGroup(driver: ChildProcess, signal: NodeJS.Signals): void {
  if (process.platform === "win32" || driver.pid === undefined) {
    driver.kill(signal);
    return;
  }
  try {
    process.kill(-driver.pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}
