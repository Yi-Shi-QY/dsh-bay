# DSH Bay 17.5 validation record

This file is the current validation entry point. Historical alpha candidate
notes were removed from the tracked tree during the repository cleanup; their
commits remain available in Git history and are not part of the current release
input. Any old local archives that remain under ignored paths are not release
inputs.

## Candidate identity

| Field | Value |
| --- | --- |
| Product | DSH Bay / 湾域 |
| Install package | `dsh-bay` |
| Candidate version | `0.2.2-alpha.17.5` |
| DSH generation | `0.2.2-rc.1` |
| Upstream commit | `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db` |
| Delivery shape | Core-only |
| Candidate record | `releases/alpha17.5-rc1-private/candidate.json` |
| Artifact verification | `releases/alpha17.5-rc1-private/package-name-verification.json` |
| Current status | `private-staging / experimental-unvalidated` |

## Recorded checks

The current candidate verification record reports:

- 122 test files and 761 passing tests;
- rc1 identity checks passed;
- Host and Client typecheck passed;
- strict package check passed;
- archive contents, build inputs and dependency closure matched;
- desktop smoke was not run in the recorded candidate.

The recorded artifact is `dsh-bay-0.2.2-alpha.17.5.tgz`. Its SHA-256 is
`69eda957cfceb8a27711300bbaa7f96edce1d839501dfcd988297ea60dc8f9a3`.

These results describe the candidate record. They do not by themselves prove
that the package has been installed or accepted in a clean DSH desktop Profile.

## Reproducible commands

Run from the repository root:

```text
pnpm install --frozen-lockfile --ignore-scripts
pnpm check:rc1
pnpm test
pnpm typecheck
pnpm build
pnpm pack:core
```

The public release gate also requires a clean DSH `0.2.2-rc.1` Profile. The
desktop pass must cover entering and leaving Workbench, restart recovery,
multi-round input, floating and locked layout stacking, custom inner-page
extensions, and complete offline package export/import.

## Source and provenance

The compatibility manifest, rc1 Sidebar/Workspace source index, upstream
adaptation record and provenance digest are the authoritative source trail:

- `compat/dsh-0.2.2-rc.1/manifest.json`
- `packages/workbench-core/rc1-sidebar-workspace-source-index.json`
- `packages/workbench-core/core-upstream-adaptation.json`
- `provenance/dsh-0.2.2-rc.1.json`

The current runtime keeps the rc1 source mirror and reviewed Workbench
adaptations only. The obsolete rc5 mirror and its checks are no longer part of
the tree.

## Release interpretation

Until the clean-profile desktop gate passes, describe this artifact as a
private candidate. Do not call it a stable release, and do not claim support
for DSH versions outside `0.2.2-rc.1` without a new compatibility record.
