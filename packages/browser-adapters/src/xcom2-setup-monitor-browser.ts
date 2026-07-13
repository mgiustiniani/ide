import {
  XCOM2_STEAM_PRODUCTS,
  type Xcom2SetupMonitorListener,
  type Xcom2SetupMonitorSnapshot,
  type Xcom2SetupMonitorUnsubscribe,
  type Xcom2SteamProductIdentifier,
  type Xcom2SteamProductStatus,
} from '@ide/contracts';
import type { Xcom2SetupMonitorPort } from '@ide/web-core/ports';

const UNAVAILABLE_MESSAGE =
  'Native Steam manifest and download monitoring is desktop-only and unavailable in a browser.';

function unavailableProduct(
  product: Xcom2SteamProductIdentifier,
  checkedAt: string,
): Xcom2SteamProductStatus {
  return Object.freeze({
    product,
    lifecycle: 'not-found',
    installDirectoryPresent: false,
    downloadDirectoryPresent: false,
    complete: false,
    completionReasons: Object.freeze([
      `${product.name} cannot be discovered because ${UNAVAILABLE_MESSAGE}`,
    ]),
    stable: false,
    stabilityReasons: Object.freeze([
      'No native Steam state is available to establish product stability.',
    ]),
    mutationBlocked: true,
    mutationBlockedReasons: Object.freeze([
      UNAVAILABLE_MESSAGE,
      'Setup planning and application are unavailable from this read-only browser boundary.',
    ]),
    checkedAt,
  });
}

function createUnavailableSnapshot(): Xcom2SetupMonitorSnapshot {
  const checkedAt = new Date().toISOString();

  return Object.freeze({
    workspaceId: 'browser-unavailable',
    generation: 0,
    steamRoot: Object.freeze({ source: 'unknown', pathRedacted: true }),
    products: Object.freeze([
      unavailableProduct(XCOM2_STEAM_PRODUCTS.game, checkedAt),
      unavailableProduct(XCOM2_STEAM_PRODUCTS.wotcDevelopmentTools, checkedAt),
    ]),
    overallState: 'not-found',
    canPlanSetup: false,
    canApplySetup: false,
    blockers: Object.freeze([UNAVAILABLE_MESSAGE]),
    warnings: Object.freeze([]),
    checkedAt,
  });
}

/**
 * Honest browser boundary for native Steam setup monitoring.
 *
 * It performs no polling, network, process, or filesystem work. The fixed
 * unavailable snapshot is safe to export and does not imply simulated setup
 * progress or success.
 */
export class BrowserXcom2SetupMonitorAdapter implements Xcom2SetupMonitorPort {
  private readonly currentSnapshot = createUnavailableSnapshot();

  getSnapshot(): Promise<Xcom2SetupMonitorSnapshot> {
    return Promise.resolve(this.currentSnapshot);
  }

  refresh(): Promise<Xcom2SetupMonitorSnapshot> {
    return Promise.resolve(this.currentSnapshot);
  }

  subscribe(listener: Xcom2SetupMonitorListener): Xcom2SetupMonitorUnsubscribe {
    let active = true;

    listener({
      type: 'snapshot',
      cause: 'initial',
      sequence: 1,
      snapshot: this.currentSnapshot,
    });

    return () => {
      if (!active) return;
      active = false;
    };
  }
}
