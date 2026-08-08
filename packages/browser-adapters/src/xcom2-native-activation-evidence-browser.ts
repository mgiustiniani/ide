import type {
  Xcom2NativeActivationAcknowledgment,
  Xcom2NativeActivationAcknowledgmentDecision,
  Xcom2NativeActivationCandidate,
  Xcom2NativeActivationLifecycleDecision,
  Xcom2NativeActivationLifecycleEvent,
} from "@ide/contracts";
import type {
  Xcom2NativeActivationEvidenceBeginRequest,
  Xcom2NativeActivationEvidencePort,
} from "@ide/web-core/ports";

const UNAVAILABLE_MESSAGE =
  "XCOM 2 native activation evidence requires desktop-only native services and is unavailable in a browser.";

/** Error raised when browser code requests native-owned XCOM 2 activation evidence. */
export class BrowserXcom2NativeActivationEvidenceUnavailableError extends Error {
  readonly code = "BROWSER_XCOM2_NATIVE_ACTIVATION_EVIDENCE_UNAVAILABLE";

  constructor() {
    super(UNAVAILABLE_MESSAGE);
    this.name = "BrowserXcom2NativeActivationEvidenceUnavailableError";
  }
}

function rejectUnavailable<T>(): Promise<Readonly<T>> {
  return Promise.reject(new BrowserXcom2NativeActivationEvidenceUnavailableError());
}

/**
 * Fail-closed browser boundary for native-owned XCOM 2 activation evidence.
 *
 * Every operation rejects without filesystem, process, network, storage,
 * native, timer, or polling work. No candidate, acknowledgment authority,
 * lifecycle decision, receipt, or native handle is fabricated or retained.
 */
export class BrowserXcom2NativeActivationEvidenceAdapter implements Xcom2NativeActivationEvidencePort {
  begin(
    _request: Readonly<Xcom2NativeActivationEvidenceBeginRequest>,
  ): Promise<Readonly<Xcom2NativeActivationCandidate>> {
    return rejectUnavailable();
  }

  acknowledge(
    _acknowledgment: Readonly<Xcom2NativeActivationAcknowledgment>,
  ): Promise<Readonly<Xcom2NativeActivationAcknowledgmentDecision>> {
    return rejectUnavailable();
  }

  revoke(
    _event: Readonly<Xcom2NativeActivationLifecycleEvent>,
  ): Promise<Readonly<Xcom2NativeActivationLifecycleDecision>> {
    return rejectUnavailable();
  }
}
