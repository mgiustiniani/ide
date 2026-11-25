interface ExplorerBrowser {
  $(selector: string): { isDisplayed(): Promise<boolean> } | PromiseLike<{ isDisplayed(): Promise<boolean> }>;
}

/** Query again on each readiness poll: workspace transitions replace the actual tree node. */
export async function nativeFileExplorerDisplayed(browser: ExplorerBrowser, rowSelector?: string): Promise<boolean> {
  try {
    const tree = '[role="tree"][aria-label="File Explorer"]';
    const explorer = await browser.$(rowSelector ? `${tree} ${rowSelector}` : tree);
    return await explorer.isDisplayed();
  } catch (error) {
    if (error instanceof Error && (
      error.name === "stale element reference" ||
      error.message.startsWith("stale element reference:")
    )) return false;
    throw error;
  }
}
