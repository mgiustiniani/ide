# Executable feature inventory

`features/**/*.feature` is the configured runner-neutral source for executable requirements and the behavioral backlog. The repository intentionally has no `PLAN.md`; requirement identity and implementation status live in Gherkin.

## Current inventory

| Feature file                                                  | Requirement                 | Target  | Classification                | Declared status                  |
| ------------------------------------------------------------- | --------------------------- | ------- | ----------------------------- | -------------------------------- |
| `workspace/startup-tooling.feature`                           | `REQ-WEB-001`               | Web     | Functional                    | `@implemented-and-validated`     |
| `workspace/application-content-layout.feature`                | `REQ-LAYOUT-WEB-001`        | Web     | Functional and non-functional | `@implemented-and-validated`     |
| `workspace/application-content-layout.feature`                | `REQ-LAYOUT-DESKTOP-001`    | Desktop | Functional and non-functional | `@implemented-not-e2e-validated` |
| `workspace/native-desktop-file-opening.feature`               | `REQ-DESKTOP-FILE-OPEN-001` | Desktop | Functional and non-functional | `@implemented-and-validated`     |
| `refactorkit/typescript-compiler-diagnostics.feature`         | `REQ-REFACTORKIT-TS-001`    | Desktop | Functional and non-functional | `@not-implemented`               |
| `refactorkit/typescript-javascript-symbol-definition.feature` | `REQ-REFACTORKIT-TS-002`    | Desktop | Functional and non-functional | `@not-implemented`               |

The inventory contains six production scenarios: three `@implemented-and-validated`, one `@implemented-not-e2e-validated`, and two `@not-implemented`. `REQ-WEB-001` and `REQ-LAYOUT-WEB-001` are selected by the implemented web profile and validated through Playwright. `REQ-LAYOUT-DESKTOP-001` is selected by the deterministic `desktop/tauri-harness` aggregate, which is not native GUI/E2E evidence. `REQ-DESKTOP-FILE-OPEN-001` is selected by the explicit `desktop/tauri-webdriver` native GUI profile and validated against a freshly built production release/no-bundle executable. This evidence does not cover a CachyOS package or any other packaged application. Both RefactorKit requirements are parked because of documented upstream bugs; supporting implementation or focused test evidence does not promote their declared `@not-implemented` status.

## Status and profile semantics

- Every production scenario owns one repository-unique `@REQ-*` ID, at least one requirement classification, and exactly one effective status.
- A status is a product implementation declaration, not a summary of every supporting test result. Focused fixtures, adapter tests, or protocol probes do not change it.
- `@implemented-and-validated @web` scenarios run through the Playwright web profile. The current selection contains two scenarios: `REQ-WEB-001` and `REQ-LAYOUT-WEB-001`.
- `@implemented-and-validated @desktop @native-gui` scenarios run through the explicit `desktop/tauri-webdriver` profile. The current selection contains exactly one scenario: `REQ-DESKTOP-FILE-OPEN-001`, with release/no-bundle native GUI E2E evidence rather than CachyOS/package evidence.
- `@implemented-not-e2e-validated @desktop` scenarios run through the deterministic `desktop/tauri-harness` aggregate. It currently selects the one `REQ-LAYOUT-DESKTOP-001` scenario but is not native GUI/E2E evidence.
- `@not-implemented` scenarios are excluded from implemented aggregates. The current count is two: `REQ-REFACTORKIT-TS-001` and `REQ-REFACTORKIT-TS-002`.
