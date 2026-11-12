# Contributing to DSH Bay

The current candidate is `dsh-bay@0.2.2-alpha.18.1`, targeting DSH `0.2.2-rc.1`. Start with the [documentation index](docs/README.md), [architecture](docs/ARCHITECTURE.zh-CN.md), [source map](docs/REPOSITORY-STRUCTURE.md), and [validation record](docs/VALIDATION.md).

## Preserve the domain boundaries

- Workbenches own root directories and persistent Projects. Areas are disposable views; closing one does not delete project data, Sessions, or task history.
- Project background and memory live in the project directory and are written through Host services. Settings adapters consume Host projections.
- Bind each inner page to its explicit Project, Session, or resource. Never infer a Session from the first tab or global focus.
- Work Items are persistent tasks; Assignments are execution attempts. Preserve deduplication, version checks, and stale callback handling.
- DSH owns the Agent Loop, native Session persistence, tools, and Plugin Manager. Browser/desktop view disposal does not own the Agent lifecycle.
- Complete V5 packages and extension runtime artifacts have different scopes. Preserve required history/resources and report missing dependencies.

The default distribution remains one Core package. Do not introduce a second Plugin Manager or alter unrelated upstream projection/geometry behavior as part of compatibility maintenance.

## Verify changes according to their impact

Use Node.js `>=24.9.0` and pnpm `11.28.5`. Feature and release checks are:

```sh
pnpm check:rc1
pnpm test
pnpm typecheck
pnpm build
pnpm pack:core
```

`pnpm verify` includes only compatibility, tests, and build. CI currently runs this command on Ubuntu; it is not a cross-platform acceptance matrix. Check the final archive separately and perform real DSH testing for native lifecycle changes.

For documentation-only changes, check relative links, referenced source paths, version/command accuracy, Markdown formatting, and package-local documentation links. Run a targeted contract test when changing documentation shipped as an Agent skill; a full runtime test suite is not automatically necessary.

Each change should explain the user-visible result, affected data or lifecycle boundary, checks performed, and unverified behavior. Keep historical evidence in `docs/archive/` with a replacement link; do not present old test counts or draft requirements as the current release contract.

Follow the user's requested commit/package sequence. A local commit, private package, installed test, remote push, and public release are distinct actions. Do not modify a user's active Profile as part of ordinary build or documentation work.
