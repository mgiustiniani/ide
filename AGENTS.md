# Repository guidance

## Documentation

1. **ARC42 is the primary reference and single source of truth.** Maintain the architecture, current capabilities, limitations, quality requirements, and product roadmap in [`ARC42.md`](ARC42.md). Do not maintain competing descriptions of the same subject in README files, plans, summaries, or status reports.
2. Write documentation for **human readers**, always in **English**. Explain the purpose, behavior, consequences, and limitations before implementation details.
3. Use established technical terminology supported by published references: arc42, C4, architecture decision records, language-server and debugger protocols, and the relevant platform specifications. Do not invent LLM-specific vocabulary, opaque receipt formats, or machine-oriented prose for human documentation. Define necessary abbreviations in the glossary.
4. **Index every architectural decision record in chapter 9 of ARC42.** Keep each decision's rationale in one place and link to it from the index; do not duplicate its body elsewhere.
5. Reference **C4 diagrams in the chapters appropriate to their scope**: system context in chapter 3, containers and components in chapter 5, runtime interactions in chapter 6, and deployment in chapter 7. Label future designs separately from implemented ones.
6. Incorporate material from other documents into the appropriate ARC42 section wherever possible. Create an appendix only when no appropriate section exists or a separate reference artifact is necessary. Every appendix must be linked from ARC42. Other entry points may contain short links, not duplicate inventories or roadmaps.
7. Every referenced document must either be a **relative link to a file included in the same repository revision** or an **HTTP(S) web link**. Never link to a developer's filesystem, temporary directory, home directory, or an absolute local path. Runtime configuration paths may be described as configuration values, not used as document references.
8. Remove redundant documentation checksums, SHA-256 verification tables, and links to individual commits. Git already versions repository documentation. This does **not** authorize removing integrity checks from software, package downloads, security controls, or transaction protocols.
9. Distinguish **implemented**, **tested**, **planned**, and **unavailable** behavior in plain language. State the scope of verification (unit tests, external tools, native UI, package, operating system) without implying that one proves another.
10. Update documentation with behavior changes. Keep command examples usable and avoid historical execution transcripts or repeating test counts throughout multiple files.

### Published references

- [arc42 documentation template](https://arc42.org/overview)
- [C4 model](https://c4model.com/)
- [Documenting architecture decisions — Michael Nygard](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)
- [Language Server Protocol](https://microsoft.github.io/language-server-protocol/)
- [Debug Adapter Protocol](https://microsoft.github.io/debug-adapter-protocol/)

## Development

- Preserve the ports-and-adapters boundary: UI and web core must not import Tauri APIs.
- Keep RefactorKit responsible for its project analysis and refactoring; do not duplicate its semantic project model in an unrelated IDE subsystem. Build tools and the JDK own compilation, test execution, application execution, and debugging.
- Protect unsaved edits, reject stale workspace operations, and never substitute fabricated success for an unavailable provider.
- Test behavior through production code. Run relevant checks and report failures honestly. Native GUI or cross-platform validation must not be inferred from an in-process test double.
- Preserve unrelated working-tree changes. Do not stage everything, amend, push, or discard work without explicit approval.
