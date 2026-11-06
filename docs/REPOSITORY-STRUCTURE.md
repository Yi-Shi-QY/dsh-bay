# DSH Bay private repository structure

This repository follows the useful conventions seen in active DSH plugin
repositories: a bilingual README, a small root package manifest, a single
plugin package, `cordis.patch.yml`, tests, docs, provenance and a release
manifest. The repository deliberately keeps the runtime package small and
does not include the launcher or a second plugin marketplace.

The ecosystem choices behind this shape are recorded in
[ECOSYSTEM-REFERENCE.md](ECOSYSTEM-REFERENCE.md). The repository identity change
from the original private candidate is recorded in
[REPOSITORY-RENAME.md](REPOSITORY-RENAME.md). The repository is private
staging for now, but its identity, install boundary and validation record are
already explicit enough to support a later catalog submission.

## Runtime package

`packages/workbench-core` is the only package shipped by the current candidate.
Its public exports cover the Core lifecycle, module contracts, composition
packages, install plans, artifact staging, native DSH Plugin Manager seams and
the client Area projection.

## Source and provenance

The Sidebar/Workspace source index records the DSH rc1 commit and source digest.
The private repository provenance file records that this checkout was derived
from the merged Workbench candidate. It is not a claim that every future
DSH Bay feature has already been validated in a clean rc1 desktop.

## Product layers

The first repository contains the Core runtime. Future layers may add a
developer-facing creator, a contract verifier UI, composition presets and a
sharing/catalog surface. Those layers must consume the Core contracts and may
not bypass DSH's native Plugin Manager or package lifecycle.
