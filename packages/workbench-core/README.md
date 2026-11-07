# DSH Bay

DSH Bay is a multi-area workbench extension for developing, validating, and
sharing DSH plugins. This package contains the runtime core and its DSH client
integration.

## Compatibility

This candidate targets **DSH `0.2.2-rc.1`** and is published as
`0.2.2-alpha.17.5`. Install it only in a compatible DSH profile. The package
name and client module id are both `dsh-bay`; the internal workbench module id
remains `workbench.core` for migration compatibility.

The package uses DSH's native Plugin Manager lifecycle. Disable the legacy
`@dsh-workbench/core` package before enabling `dsh-bay` in the same profile so
that two workbench cores are not registered at the same time.

## Install

```text
pnpm add dsh-bay
```

For a private trial, install the matching `.tgz` artifact from the repository's
`releases/alpha17.5-rc1-private/` directory. The repository release record is
the source of truth for its SHA-256, provenance and validation status.

## Package boundary

The default delivery is Core-only. Conversation Suite and the SVG pet remain
separate modules and are intentionally excluded from this package. DSH owns
the host lifecycle, native pages, Plugin Manager, sessions and agent runtime;
DSH Bay adds the workbench surface, Area/session placement, native page
projection with fallback, and package provenance metadata.

This candidate is private staging material. Its repository validation covers
source identity, dependency closure, tests, type declarations, build output and
archive contents. A real DSH desktop smoke test is still required before a
public release.

See the repository documentation for the current [validation record](https://github.com/Yi-Shi-QY/dsh-bay/blob/main/docs/VALIDATION.md)
and [publishing checklist](https://github.com/Yi-Shi-QY/dsh-bay/blob/main/docs/PUBLISHING.zh-CN.md).
The package license is included as [`LICENSE`](./LICENSE).
