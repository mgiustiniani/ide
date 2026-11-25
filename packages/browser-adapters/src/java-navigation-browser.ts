import { javaNavigationRefusal, type JavaNavigationRequest } from "@ide/contracts";
import type { JavaNavigationPort } from "@ide/web-core";

export class BrowserJavaNavigationAdapter implements JavaNavigationPort {
  async cancel(): Promise<void> {
    /* No native query is owned by the browser provider. */
  }
  async stop(): Promise<void> {
    /* No native session is owned by the browser provider. */
  }
  async query(request: JavaNavigationRequest) {
    return javaNavigationRefusal(
      request,
      "unavailable",
      "Java binding navigation requires the desktop RefactorKit provider.",
    );
  }
}
