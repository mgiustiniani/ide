# C4 workspace validation

[`workspace.dsl`](workspace.dsl) is the architecture source of truth. Validate it with Structurizr CLI **2026.06.28**:

```bash
structurizr validate -workspace docs/c4/workspace.dsl
```

The repository does not own a Structurizr container or image invocation. It therefore does not pin an image tag or digest. The version above is the validated CLI compatibility boundary; installation and acquisition of that CLI remain external to this repository.

## Self-contained rendering

The workspace intentionally has no `theme` declaration. Its explicit styles cover the generic rounded element shape, software-system and container boundaries, and every modeled person, software system, container, component, external system, target element, and frozen element. This keeps the established C4 colors, shapes, boundaries, and target/frozen borders under repository control without fetching the former Structurizr Cloud default theme.

For migration comparison, the former default theme was retrieved on 2026-07-15 from `https://static.structurizr.com/themes/default/theme.json`; its SHA-256 was `e37ec2c05c1b8544beb0c0f132381c708806d65359ca2181d48240c3488e9b7e`. No theme file is vendored: the small generic shape and boundary settings that affected these views are expressed directly in the DSL.

A future remote theme must not be added. If a theme becomes necessary, vendor the authoritative file locally together with its license, source URL, retrieval date, and SHA-256 checksum, then reference only that local file from the DSL.

## Offline boundary

First-time acquisition of Structurizr CLI or a chosen execution image can require network access. Once Structurizr CLI 2026.06.28 is available locally, validation and export of this workspace require no network access: the DSL has no remote include or theme dependency. Image selection and supply-chain verification remain the responsibility of the execution environment because this repository invokes no image.

Views use deterministic `autoLayout lr`; there is no curated `workspace.json` layout in this repository. Exports are derived review artifacts and should be generated outside the working tree unless a separate change explicitly adopts them.
