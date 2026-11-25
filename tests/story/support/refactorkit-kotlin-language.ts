/**
 * Minimal Story driver for REQ-IDE-KOTLIN-LANGUAGE-001 (Kotlin highlighting,
 * definition, and references presented from the RefactorKit engine kotlin
 * commands through provider-neutral ports). RED-state holder for its six
 * scenarios. Mirrors the java-project-model driver's SHAPE (a world-scoped
 * session plus get/dispose accessors), not its size: no engine boundary, DOM
 * harness, adapter, or controller harness is constructed because no Kotlin
 * production behavior exists yet. Every getter reports the honestly observed
 * state, so GREEN cannot be reached by fabricating Kotlin results here.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { StoryWorld } from "./world.js";

export const REQUIREMENT = "REQ-IDE-KOTLIN-LANGUAGE-001";
export const WORKSPACE_ID = "workspace-kotlin-language";
export const KOTLIN_DOCUMENT_PATH = "src/main/kotlin/example/Order.kt";
export const KOTLIN_LANGUAGE_ID = "kotlin";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(MODULE_DIR, "../../..");
const REAL_ENGINE_PATH = join(
  REPO_ROOT,
  "apps/desktop/src-tauri/src/commands/refactorkit_daemon/real_engine.rs",
);

/** Production layers a Kotlin GREEN must reach. All three are false at RED. */
export interface KotlinProductionGap {
  readonly engineDefinesKotlinCommands: boolean;
  readonly adapterDelegatesKotlin: boolean;
  readonly controllerKotlinPathWired: boolean;
}

export class RefactorKitKotlinLanguageStorySession {
  #started = false;

  /** AC-001..AC-004 precondition: an authorized workspace with a Kotlin document. */
  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
  }

  /** AC-001: Monaco Kotlin language assignment and syntax highlighting. */
  get kotlinHighlightingWired(): boolean { return false; }

  /** AC-002: an engine kotlin definition location presented and revealed. */
  get kotlinDefinitionPresented(): boolean { return false; }

  /** AC-003: engine kotlin references presented and a selected one revealed. */
  get kotlinReferencesPresented(): boolean { return false; }

  /** AC-004: production reports the absent Kotlin capability honestly. */
  get honestUnavailable(): boolean { return false; }

  /** Whether the real engine defines the kotlin commands (observed: it does not). */
  productionGap(): KotlinProductionGap {
    let engineText = "";
    try {
      engineText = readFileSync(REAL_ENGINE_PATH, "utf8");
    } catch {
      engineText = "";
    }
    return {
      engineDefinesKotlinCommands:
        /run_engine_kotlin_definition/u.test(engineText) &&
        /run_engine_kotlin_references/u.test(engineText),
      adapterDelegatesKotlin: false,
      controllerKotlinPathWired: false,
    };
  }

  dispose(): void {
    if (!this.#started) return;
    this.#started = false;
  }
}

/**
 * World-scoped session accessor shared by the Kotlin steps and the shared
 * operational steps so both reach the SAME session per world. It lives here,
 * not in a steps file, so no runner profile loads Kotlin step definitions it
 * should not.
 */
const sharedSessions = new WeakMap<StoryWorld, RefactorKitKotlinLanguageStorySession>();

export function getRefactorKitKotlinLanguageSession(
  world: StoryWorld,
): RefactorKitKotlinLanguageStorySession {
  let session = sharedSessions.get(world);
  if (session === undefined) {
    session = new RefactorKitKotlinLanguageStorySession();
    sharedSessions.set(world, session);
  }
  return session;
}

/** Disposes and releases the session for a world, if one was created. */
export function disposeRefactorKitKotlinLanguageSession(world: StoryWorld): void {
  const session = sharedSessions.get(world);
  if (session !== undefined) {
    session.dispose();
    sharedSessions.delete(world);
  }
}
