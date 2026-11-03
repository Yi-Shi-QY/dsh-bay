# Alpha.17 validation record

Candidate: `areadeck-0.2.2-alpha.17-dsh-0.2.1-rc.5`

Recorded: 2026-11-04

## Passed in the private staging checkout

| Check | Result |
| --- | --- |
| Candidate/version/upstream identity | passed by `pnpm check:rc5` |
| DSH upstream commit | `b830ec950faba0a46dda564be3e2d854afed94f1` |
| rc5 source digest and 34-file index | passed by `pnpm check:rc5` |
| Core-only default and excluded modules | passed by `pnpm check:rc5` |
| More policy and Workbench projection filter | passed by `pnpm check:rc5` |
| Core runtime build | passed by `pnpm build` |
| Existing Core test suite | passed by `pnpm test` |

The test run emits expected jsdom and missing upstream source-map warnings. They
do not change the test exit status.

## Held gates

`pnpm typecheck` currently fails in the copied rc5 Sidebar/Workspace tree. The
failure is in the existing controlled-rebase boundary: the runtime destination
keeps reviewed Workbench adaptations while the exact rc5 mirror contains the
newer upstream declarations. The errors include missing adapted slot exports,
workspace tree helpers and injected props. This is recorded as a migration
blocker rather than hidden with `skipLibCheck` or an `any` cast.

`pnpm pack:core` depends on that declaration gate and is therefore held as
well. No package tarball in this repository should be treated as a release
artifact until the source tree is reconciled and the typecheck passes from a
clean install.

The candidate state is `private-staging / experimental-unvalidated`. A real
DSH rc5 desktop smoke, including official inner pages, Area/session binding,
minimum footprint behavior, More isolation and LAN Share, remains a release
gate.
