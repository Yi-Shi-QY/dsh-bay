# AreaDeck | 随想域

AreaDeck is a lightweight multi-area workbench for DeepSeek Harness (DSH).
It gives each task a bounded workspace where native DSH Sessions, Files,
Terminal, Browser and other official surfaces can be composed and restored.

This repository is a private staging repository for the `0.2.2-alpha.17`
Core-only candidate. It is intentionally separate from the research and
migration repository. The repository is not published and does not push to a
remote by default.

## Current candidate

| Field | Value |
| --- | --- |
| Product | AreaDeck / 随想域 |
| Core package | `@dsh-workbench/core@0.2.2-alpha.17` |
| DSH generation | `0.2.1-rc.5` |
| DSH upstream commit | `b830ec950faba0a46dda564be3e2d854afed94f1` |
| Delivery | Core-only |
| Candidate state | private staging / experimental-unvalidated |

The default installation contains only `@dsh-workbench/core`. Conversation
Suite and SVG DeepSeek Pet remain excluded from this candidate. Workbench More
is deferred; the official DSH `ui-entry-customization` remains an official
surface and is filtered only at the Workbench projection boundary.

## What AreaDeck provides

- Persistent multi-area layout with split, close, restore and explicit minimum
  footprint constraints.
- Area-local Session binding so simultaneous Sessions do not cross-update.
- Native projection for Workspace Files, Terminal, Browser, Document Preview,
  Changes Review, Plan, Schedule Task, Guide and Subagent Chat when DSH offers
  the corresponding entry.
- Explicit fallback and diagnostic seams when a native entry is unavailable.
- Module identity, composition package, artifact staging and provenance
  contracts for future plugin development and sharing flows.
- DSH-native Plugin Manager integration through the existing Settings entry.

AreaDeck is additive. It does not replace DSH's AgentLoop, SessionEvent,
LLM, Tool, Prompt, Profile or native plugin lifecycle.

## Development

Requirements: Node.js 24 or newer and pnpm 11.28.5.

```text
pnpm install --frozen-lockfile --ignore-scripts
pnpm verify
```

`verify` runs the rc5 identity check, the Core test suite and the runtime
build. The generated Sidebar/Workspace declaration gate is tracked separately
in [docs/VALIDATION.md](docs/VALIDATION.md); the current private candidate is
not presented as a publishable package until that gate and desktop smoke pass.

The current candidate remains private until the rc5 desktop smoke gates,
generated Sidebar/Workspace type gate and provenance review are complete.

## Repository shape

```text
packages/workbench-core/   the only shipped runtime package
scripts/                   reproducible build, check, test and pack entrypoints
docs/                      product and repository notes
provenance/                DSH and candidate identity records
releases/                  local candidate manifests and artifacts
```

The repository intentionally does not contain the research workspace,
launcher, community hub, Conversation Suite runtime or historical migration
trees.

## Name and positioning

AreaDeck is the international product name. 随想域 describes the same idea in
Chinese: every idea gets its own work domain. The product direction is
"develop, verify, compose and share DSH plugins", while this first repository
freezes the Core runtime that makes those flows possible.

## License

Workbench code is released under the MIT License. Upstream and third-party
notices are listed in `THIRD_PARTY_NOTICES.txt`.
