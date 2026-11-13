# DSH Bay｜湾域

DSH Bay is a multi-area workbench for DSH projects, native conversations, inner-page extensions, and Bay Agent tasks. This package contains the Host runtime, client integration, and extension development skill.

## Compatibility and installation

This private candidate is **`dsh-bay@0.2.2-alpha.18.3`**, targeting **DSH `0.2.2-rc.2`**. The package name and client module ID are `dsh-bay`; the internal module ID is `workbench.core`.

Install the supplied `dsh-bay-0.2.2-alpha.18.3.tgz` through DSH's native Plugin Manager and follow its restart instructions. The repository's local build output is `releases/alpha18.3-rc2-private/`; this candidate is private and is not published to the public registry.

Disable the legacy `@dsh-workbench/core` package before enabling `dsh-bay` in the same Profile. Package renaming does not imply migration of 17.x workbenches or old complete-package formats; those are unsupported by the 18.x directory workflow.

## The 18.0 model

A Workbench owns its root directory and persistent Projects. Projects own background, memory, and conversation/task relationships; Areas are disposable views. One Area can show multiple Sessions. Closing an Area preserves its Project; reopening the project shows an overview before the user opens historical tabs or resumes a task.

Bay Agent has a persistent Main Session and discovers available native Worker modes. Its native Session compaction, orchestration checkpoints, and background/memory projections are separate mechanisms. Browser takeover uses the same Host services. Complete Workbench V5 packages restore files, native history, attachments, and task relationships; imported tasks wait for the user.

## Package boundary

DSH owns the native Agent Loop, Session persistence, tools, and Plugin Manager. Conversation Suite and SVG Pet remain separate, excluded modules. The bundled development skill is available to native `cordis` mode; this package does not install a replacement Creator preset.

Read the included [extension development skill](presets/workbench-creator/skills/workbench-extension-development/SKILL.md) and [extension specification](presets/workbench-creator/skills/workbench-extension-development/WORKBENCH-CONTAINER-INNER-PAGE-EXTENSION-SPEC.zh.md) for portable state and runtime artifact rules.

Automated checks and private packaging do not prove acceptance in a clean DSH desktop, across platforms, or during long real-model runs. The repository [validation record](https://github.com/Yi-Shi-QY/dsh-bay/blob/main/docs/VALIDATION.md) and [documentation index](https://github.com/Yi-Shi-QY/dsh-bay/blob/main/docs/README.md) state the evidence and remaining checks. License: [MIT](LICENSE).
