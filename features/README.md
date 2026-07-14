# Executable feature inventory

`features/**/*.feature` is the configured runner-neutral source for executable requirements and the behavioral backlog. The repository intentionally has no `PLAN.md`; requirement identity and implementation status live in Gherkin.

## Current inventory

| Feature file                                                  | Requirement              | Target  | Classification                | Declared status              |
| ------------------------------------------------------------- | ------------------------ | ------- | ----------------------------- | ---------------------------- |
| `workspace/startup-tooling.feature`                           | `REQ-WEB-001`            | Web     | Functional                    | `@implemented-and-validated` |
| `refactorkit/typescript-compiler-diagnostics.feature`         | `REQ-REFACTORKIT-TS-001` | Desktop | Functional and non-functional | `@not-implemented`           |
| `refactorkit/typescript-javascript-symbol-definition.feature` | `REQ-REFACTORKIT-TS-002` | Desktop | Functional and non-functional | `@not-implemented`           |

`REQ-WEB-001` is selected by the implemented web profile and validated through Playwright. Both RefactorKit requirements are parked because of documented upstream bugs; supporting implementation or focused test evidence does not promote their declared `@not-implemented` status.

## Status and profile semantics

- Every production scenario owns one repository-unique `@REQ-*` ID, at least one requirement classification, and exactly one effective status.
- A status is a product implementation declaration, not a summary of every supporting test result. Focused fixtures, adapter tests, or protocol probes do not change it.
- `@implemented-and-validated @web` scenarios run through the Playwright web profile. The current selection is `REQ-WEB-001`.
- `@implemented-not-e2e-validated @desktop` scenarios run through the deterministic `desktop/tauri-harness` aggregate. That harness exists but is not packaged native GUI/E2E evidence and currently selects zero scenarios.
- `@not-implemented` scenarios are excluded from implemented aggregates. This currently excludes `REQ-REFACTORKIT-TS-001` and `REQ-REFACTORKIT-TS-002`.
