# DSH Bay validation records

## Alpha.17.3 source spacing follow-up — 2026-11-05

Current private artifact: releases/alpha17.3-source-spacing-private/dsh-workbench-core-0.2.2-alpha.17.3-source-spacing-3eb91ce661f9.tgz. Revision r14 retains r13 and changes only WorkbenchFloatingWorkspace.module.css among build inputs: project names use intrinsic width with a 38% cap, instead of reserving 38% of the source row. Project, separator and conversation now remain adjacent, with ellipsis for long names.

Five focused client tests and build passed. Installed Web/Edge checks covered 720px/360px floating windows, long/short labels, dark/light themes and closing after resize; no overflow, page errors or failed requests. All 277 installed package files matched the archive, and build-input hashes matched current sources. Full r13 evidence and known limitations below remain applicable; formal typecheck remains blocked by 112 existing generated/upstream errors. Package identity and spacing measurements are in releases/alpha17.3-source-spacing-private/candidate.json and spacing.json.

Pre-merge verification on the complete r14 source passed on 2026-11-05: pnpm verify completed RC5 checks, 119 test files / 738 tests, and the build. The existing typecheck baseline remains a separate formal-release blocker; it is not included in pnpm verify. Local log: %TEMP%/dsh-bay-173-merge-verify.log.

## Alpha.17.3 floating workspace feedback fixes — 2026-11-05

See [17.3 validation record](VALIDATION-17.3.zh-CN.md). Current candidate r13: 738 tests across 119 files passed, RC5 identity/build passed; 112 existing type errors match the normalized baseline and hold the formal release gate. Fixes include close guards, source labels, header-only floating drops, valid pending bindings on pin/merge, and temporary tabs following trusted browser control handoff. The installed r13 passed 18 Electron merge rounds and both Web and Electron-to-separate-Edge return flows. The latter uses a test-controlled URL launcher; it does not exercise the default browser association. An earlier distinct intermittent blank page remains unresolved. The exact tested archive, 2026-11-05 01:49:45 +08:00 packing time, SHA-256 and evidence are recorded in releases/alpha17.3-private/candidate.json; r8 remains historical only.

## Area tab top scrollbar and wheel navigation — 2026-11-04

Current artifact: releases/alpha17.2-tab-scroll-private/dsh-workbench-core-0.2.2-alpha.17.2-tab-scroll-ec19a346f22a.tgz. SHA-256: ec19a346f22ae9165295d5bb7e31f5080ccec9426aca2e34dd594643b06e4bb8. Verified 2026-11-04 19:48 Asia/Shanghai. Earlier archives do not include this scrolling change.

- Expanded Area tab lists put their native horizontal scrollbar above the labels, using a 4px track and the existing DSH scrollbar colors. Tab content remains upright. The tab row and scrollbar fit the existing 32px header; collapsed rails retain their own geometry.
- A local non-passive wheel listener translates vertical mouse-wheel input to horizontal tab movement across the tab strip, including its controls. Horizontal touchpad input retains its direction; line/page deltas normalize; positions clamp at either end. Modified zoom input and non-overflowing lists keep normal behavior. Scrolling does not select tabs or save layouts, and wheel events over Area content remain outside this handler.
- Source verification: 111 files / 695 tests passed, including two new wheel regressions; focused client checks passed 3 files / 55 tests. Build and RC5 identity passed. Typecheck remains at 112 existing generated Sidebar/Workspace errors with zero new errors. The final change after those tests only adjusted scrollbar/tab CSS, then was rebuilt and verified in the browser. Strict release gate remains held; separately packed experimental private trial.
- Actual installed package in the isolated web Profile, Edge/Playwright because Browser plugin is not available: forward/back wheel scrolling, horizontal input, hovering the add control, modified wheel, Area-body wheel isolation, native top-scrollbar dragging, keyboard End selection/reveal and upright labels passed. Real divider geometry fills its extent; 1440×1000 light/dark and 720×580 layouts render without page/console errors. Playwright's default --hide-scrollbars argument was explicitly removed for the native scrollbar check; no sizing styles were injected.
- Final archive extraction verified 373 source-input hashes, retained features, new wheel/top-scrollbar code, root/Core/Creator compatibility identity and exact installed/build Host/Client bytes. candidate.json and SHA256SUMS.txt bind evidence to this archive. Evidence: C:/Users/WeChenXC000/AppData/Local/Temp/dsh-bay-tab-scroll.
- Native Electron, real Companion/LAN, bound-Session-specific interactions and two-Profile distribution migration were not rerun. The user's daily Profile was untouched.

## Area header compression and natural grid coverage — 2026-11-04

Current artifact: releases/alpha17.2-area-header-private/dsh-workbench-core-0.2.2-alpha.17.2-area-header-d75dbab26a0f.tgz. SHA-256: d75dbab26a0f84fd2d9f8a88dff53eb39a28021952c04c327a6b6fd3ef427b05. Verified 2026-11-04 19:30 Asia/Shanghai. Earlier archives do not include this header repair.

- Root cause: flex compression shrank tab selectors and Session-binding controls below their SVG widths; later chrome styles also overrode parts of older narrow-area rules. Expanded headers now reserve non-shrinking controls and bounded tab selectors. Existing collapsed rails and Area geometry remain independent.
- At 400px and below, Session binding uses its marker and secondary tab controls compact; at 319px, only the active tab remains in the strip; at 239px, tab text and direct overview hide; at 179px, add/collapse move to the Area menu; at 119px, the strip hides. The menu retains adding, listing/switching, closing, detaching and collapsing. Overview/picker anchors and Escape focus return follow the actual trigger. Detach moves the original tab without duplication.
- Source verification: 111 files / 693 tests passed, including two new menu regression tests; focused client checks passed 3 files / 53 tests. Build and RC5 identity passed. Typecheck remains at 112 existing generated Sidebar/Workspace errors, zero new errors. Strict release gate remains held; this is a separately packed experimental private trial.
- Real installation into the isolated web Profile, Edge/Playwright because Browser plugin is not available: 20 Area widths from 568px to 64px in both themes, multiple retained tabs, SVG/hit-target bounds and control overlap, narrow-menu add/list/switch/close, Escape focus, pending binding at 96px and collapse/expand passed with no page or console errors. Already-bound Session header geometry was not separately verified in-browser.
- The earlier misleading screenshot came from a temporary stress-only width override on Area elements without changing the outer grid allocation. That test-only style is outside the repository and is removed before natural-layout checks. The real four-Area preset, divider drag, 720×580 viewport and reload were then checked without injected sizing styles: each split's children and separator fill its extent within 2px, with no button overlap. Light/dark screenshots at 1440×1000 and a narrow screenshot record the actual layout.
- Final archive extracted and compared with all 373 build-input hashes, root/Core/Creator compatibility identity, retained launcher/SVG features, new header/menu code and exact Host/Client bytes installed in the isolated Profile. candidate.json and SHA256SUMS.txt bind the evidence to the delivered archive. Evidence: C:/Users/WeChenXC000/AppData/Local/Temp/dsh-bay-area-header.
- Native Electron, real Companion/LAN and two-Profile distribution migration were not rerun for this header-only follow-up. Daily user Profile was untouched; previous acceptance remains separately recorded.

## Empty Area launcher and editor SVG identity — 2026-11-04

Current artifact: releases/alpha17.2-empty-area-private/dsh-workbench-core-0.2.2-alpha.17.2-empty-area-92ad5c51395e.tgz. SHA-256: 92ad5c51395e551a31ccc6e6dbd84a3b7f2392b4b638d1184ed83328d2deeaaa. Verified 2026-11-04 18:57 Asia/Shanghai. Earlier archives do not include this launcher and SVG contract.

- Empty Areas use the live permitted editor catalog, five direct shortcuts and a searchable “更多内页” action. Normal size shows names and icons; width at most 360px or body height at most 240px shows icons only; width at most 180px or body height at most 96px shows only the browse icon. Thresholds use Area body size, not window size. The native portal tooltip exposes names on hover and keyboard focus. Existing add-tab and Session-binding behavior is preserved.
- All twelve official editors have distinct semantic SVG glyphs. Private editors can supply a validated, bounded, path-only SVG descriptor; the same resolver is used in launcher, picker, tabs, previews and Settings. No raw SVG markup, external images, arbitrary styles or events are accepted. Creator template and extension specification require a function-specific authored icon and visual checks at 16/20/24px in both themes. Old extensions retain a stable compatibility glyph, which is explicitly not a guarantee of semantic quality or global uniqueness.
- Source verification: 111 files / 691 tests passed; build and RC5 identity passed. Typecheck remains at 112 existing generated Sidebar/Workspace errors, zero new errors. Strict release gate remains held; the archive is a separately packed experimental private trial.
- Actual installation into the isolated dsh-bay-172-home web Profile, tested with Edge/Playwright because the Browser plugin is not available: light/dark, 1440×1000, 720×580, 390×720, 1440×400 and 1440×220; compact hover/focus names; search, no results, arrows/Enter, Escape/focus return; root selection only affects its Area; Session editor waits for binding; reload restores layout and custom glyph. At a 45px body height, only the browse icon is visible with no scrollbar and its full picker remains usable. No page or console errors.
- Updated Creator template was installed as @local/empty-area-icon-qa@0.1.0 and explicitly allowed through Workbench UI in the isolated Profile. Its notebook glyph was verified in the picker, tab, Settings and Home preview, including after reload. This is local plugin installation acceptance, not a rerun of two-Profile distribution migration. The daily user Profile was untouched.
- Real rendering caught CSS-module-local named containers preventing responsive queries; the launcher now queries its nearest Area body. Final archive extraction verified all 373 build-input hashes, Creator documents/template, public icon declarations and exact Host/Client bytes against the build and the actually installed package. Evidence: C:/Users/WeChenXC000/AppData/Local/Temp/dsh-bay-empty-area.
- Native Electron, real Companion/LAN and two-Profile distribution migration were not rerun for this visual follow-up. Previous acceptance is retained separately and is not represented as fresh acceptance of this archive.

## Menu import follow-up — 2026-11-04

Current artifact: releases/alpha17.2-menu-import-private/dsh-workbench-core-0.2.2-alpha.17.2-menu-import-11fef0faac82.tgz. SHA-256: 11fef0faac82bca1e3a025b8e04adaa8f32b23e23209f7ca01014f529db2e2c3. Recorded 2026-11-04 18:08:36 Asia/Shanghai. Earlier archives do not include the menu import action.

- Removed the visible layout-group heading while retaining the accessible group name. The 232×145 native menu now places an import icon beside blank-workbench creation, with tooltip/accessibility label “导入工作台包”. The lower eight SVG layout choices are unchanged.
- Rail and Home creation menus route to the existing Home import page. The rail uses an explicit import callback independent of desktop geometry, so the full web host also receives it; Browser Companion and LAN guests do not receive a global import entry. Existing lifecycle flush and Home navigation guards remain in use.
- Source checks: 109 files / 669 tests passed; build and RC5 identity passed. Typecheck remains at 112 existing generated Sidebar/Workspace errors with zero new errors. Strict release gate remains held; separately packed experimental private trial.
- Actual installed package in the isolated web Profile, Edge/Playwright (Browser plugin not available): active-workbench rail import, Home import, keyboard Enter, Escape/focus, light/dark, 1440×1000 and 390×720, no visible layout heading, compact bounds, creation cancellation, unchanged Settings and zero page/console errors all verified. The daily Profile was untouched.
- Extracted final archive matched all 368 build inputs, Creator files and actual installed Host/Client bytes. Evidence: C:/Users/WeChenXC000/AppData/Local/Temp/dsh-bay-menu-import. Native Electron, Companion/LAN and two-Profile private-extension installation were not rerun for this menu-only change.

## Compact creation menu follow-up — 2026-11-04

Current artifact: releases/alpha17.2-compact-create-private/dsh-workbench-core-0.2.2-alpha.17.2-compact-create-efdc63c0119b.tgz. SHA-256: efdc63c0119b3e73ade7a88b3b92641db6122d2235ac462bac9337e3f3cbb5db. Recorded 2026-11-04 17:59:11 Asia/Shanghai. This replaces the preceding three-step creation UI; prior archives remain historical.

- The rail plus and Home creation buttons now share a 232×167 native menu: blank workbench above eight small SVG split-layout icons. No saved-layout choices or large template cards. Hover titles, accessible names, arrow navigation and Escape focus return are retained.
- After selecting a layout, a single compact dialog asks only for name and optional description. Creation opens empty Areas. All editor selection stays inside the existing Workbench Area picker; no module choices, Session binding or multi-step instructions are included in creation.
- Source checks: 109 files / 667 tests passed; build and RC5 identity passed. Typecheck remains at the same 112 existing generated Sidebar/Workspace errors, zero new errors. Strict release gate remains held; this archive is an experimental private trial.
- Real isolated web Profile with Edge/Playwright (Browser plugin not available): light/dark menu, horizontal and vertical keyboard navigation, Escape, name autofocus, Enter submission, Home/rail parity, three empty Areas, selecting an editor inside one Area without changing the other Areas, cancellation, reload persistence, 390×720 narrow and 900×480 short-window layouts passed. No page or console errors. User daily Profile untouched.
- Final archive extracted and checked against all 368 source/build inputs, Creator identity/files, and actual installed Host/Client bytes. candidate.json and SHA256SUMS.txt bind this evidence to the delivered file. Logs and screenshots: C:/Users/WeChenXC000/AppData/Local/Temp/dsh-bay-compact-create.
- Native Electron, real Browser Companion/LAN and two-Profile distribution migration were not rerun for this creation-only follow-up; previous evidence remains separately recorded.

## Area-preset creation follow-up — 2026-11-04

Current artifact: releases/alpha17.2-area-presets-private/dsh-workbench-core-0.2.2-alpha.17.2-area-presets-5a81e11c7e81.tgz. SHA-256: 5a81e11c7e8155ae8822a63afef8f5ccdad31c10bd71339a393a562565b78e53. Created 2026-11-04 17:45:46 Asia/Shanghai. This supersedes the visual follow-up archive for the creation workflow.

- Home and the top-rail plus button now use one creation wizard: name/description, nine fixed geometry presets, then one optional module per numbered Area. Removed the saved-layout creation menu. Existing saved layouts and compatibility API remain intact.
- Presets generate fresh Area/split/module identities, empty state and explicit pending bindings for Session-scoped modules; they do not copy another Workbench or create Sessions. Root modules use the existing runtime. Hidden/resource-only editors follow the existing picker policy, and disappeared selections block submission until reselected or cleared.
- Directory writes remain atomic and revision guarded, including empty Settings initialization, invalid-preset rejection, duplicate names and conflict retry. Regression verifies all nine geometries survive Settings decoding, exact module-to-Area placement, no inherited bindings and retained choices after retry/back.
- Final source checks: 109 files / 665 tests passed; build and RC5 identity passed. Typecheck remains at 112 existing generated Sidebar/Workspace declaration errors, zero new errors. Strict release gate remains held; the archive is a separately packed experimental private trial.
- Real isolated DSH web Profile, Playwright/Edge (Browser plugin not available): rail/Home creation, light/dark preset selection, three-Area root/Session assignment, cancellation, persisted reload, 1440×1000 desktop, 390×720 narrow and 900×480 short-window dialogs passed, with zero page/console errors. No blank page or framework overlay. User daily Profile untouched.
- Final archive extracted: all 365 build-input hashes, Creator files, version and runtime bytes checked against source/build and installed test Profile. Package metadata and SHA256SUMS.txt are beside the archive. Screenshots/logs: C:/Users/WeChenXC000/AppData/Local/Temp/dsh-bay-area-presets. Native Electron/real Companion/LAN/two-Profile distribution acceptance was not rerun for this creation follow-up; earlier evidence is retained separately.

## Home visual redesign — 2026-11-04

Current visual follow-up artifact: releases/alpha17.2-home-design-private/dsh-workbench-core-0.2.2-alpha.17.2-home-design-9a4f35db2123.tgz. SHA-256: 9a4f35db21230e1ad60082bc89835102091ac6960c672df9a38c01190f7d6794. Created 2026-11-04 17:12:06 Asia/Shanghai. Earlier Home and distribution archives below do not contain this redesign.

- Reference: the official DeepSeek and Harness websites, plus installed RC5 native primitives and theme tokens. The overview uses native Button/Input/Pill/Menu/Modal, quiet navigation, real read-only split-layout thumbnails, state filters and a three-step creation wizard. Full management and distribution remain in Home.
- Final source regression: 108 files / 651 tests passed. Build and RC5 identity checks passed. Typecheck remains at 112 existing errors, all in generated Sidebar/Workspace declarations; zero new errors. Strict release gate remains held, and this is a separately packed experimental trial.
- Final archive installed into an isolated DSH web Profile and checked with Playwright/Edge (Browser plugin not available), at 1440×1000, 640×900 and 390×900. Native system dark theme, two-Area preview, search/filter, card menu keyboard export, import/history, three-step creation, confirmed deletion, focus/Escape and responsive overflow checks passed. No page or console errors; page identity was DeepSeek Harness, with no blank screen/framework overlay.
- Visual corrections verified: aligned card footers, native theme/font tokens and narrow modal layout. Real interaction also exposed and fixed normalized-tag false dirty detection and an incorrectly positioned unsaved-changes prompt; save normalization and viewport-centered cancel/continue behavior have regression evidence.
- Extracted the final archive and checked all 363 build-input hashes, package/Creator identity, and Host/Client bytes against both the build and the actually installed test Profile. candidate.json and SHA256SUMS.txt bind this evidence to the delivered archive.
- Screenshots, browser evidence and logs: C:/Users/WeChenXC000/AppData/Local/Temp/dsh-bay-home-design. Daily user Profile untouched. Native Electron, real Browser Companion/LAN and private-extension two-Profile migration were not rerun for this visual follow-up; their earlier evidence is not represented as new acceptance of this archive.

## Home management follow-up — 2026-11-04

Current follow-up artifact: releases/alpha17.2-home-private/dsh-workbench-core-0.2.2-alpha.17.2-home-2cc0def53672.tgz. SHA-256: 2cc0def5367214252133f127f8c20d154f68d3ee2665b5a641e75fd91d769fa5. The earlier artifact and its two-Profile distribution evidence below remain historical evidence, not a fresh private-extension test of this archive.

- Full suite: 108 files / 647 tests passed. After final presentation corrections, the affected 8 files / 87 tests passed again.
- Build and RC5 identity passed. Typecheck remains at the same 112 existing generated Sidebar/Workspace declaration errors, with zero new errors. The strict release gate remains held; this is a separately packed experimental trial.
- Real isolated DSH web Profile, Edge at 1440×1000 and 640×900: sole-workbench archive, restore, confirmed deletion, empty Home after full Host restart, create/open, metadata leave guard, Home management/distribution/history and reduced Settings passed. No page or console errors.
- Layout-package export/download/inspection/confirmed import/open completed through Home. Import did not automatically open or replace the current workbench. Native Electron and real Browser Companion interaction were not rerun for this follow-up; automated regression passed.
- The final archive was extracted and verified against the built and installed Host/Client bytes, version, Creator files and all 360 build-input hashes. Metadata is in that directory's candidate.json. The user's daily Profile was untouched.

## Earlier 17.2 distribution candidate

Recorded: 2026-11-04 (Asia/Shanghai). Runtime: Node 24.19.0; repository pnpm 11.28.5; native DSH package operation pnpm 11.19.0. DSH is 0.2.1-rc.5.

## Source and build checks

| Check | Result |
| --- | --- |
| pnpm test, including relevant React/client tests | 107 files / 642 tests passed |
| pnpm build | passed, Host and Client runtime rebuilt |
| pnpm check:rc5 | passed |
| pnpm typecheck | 112 existing RC5 Sidebar/Workspace declaration errors; no new errors |
| strict pnpm pack:core | held by typecheck; gate preserved |

The exact type-error lines match the prior 112-error baseline. The private trial archive is separately produced with pnpm pack --out after rebuilding and attempting type emission. It does not satisfy the strict release gate.

## Real isolated installation

A sender DSH Profile exports a signed V4 offline package with a private client-only Bundle and a private client-host Bundle. A new receiver-verified Profile starts with compatible DSH/Core only, no private extensions, and an independent empty pnpm store. Import uses the actual Home/Settings interface, native package operations, and a single confirmation. The result is restart-required before any workbench is committed.

After DSH restart, the user continues from import history. Two Areas, split ratio 0.6, three retained tabs, tab order and selected page, metadata and per-tab configuration restore. The imported workbench is initially closed. The Open action leaves Home correctly. The client button updates persisted state; the Host button invokes the installed private Host endpoint and verifies answer=42. A second DSH restart verifies persistence and the Host endpoint again. The user's daily Profile was not touched.

The receiver uses an unreachable Registry, independent empty store, a Node preload rejecting non-loopback connect/DNS in Host and native pnpm children, and Playwright blocking non-local browser requests. This is process-level network-restricted acceptance, not physical disconnection or an OS-wide/all-protocol isolation proof.

A separate real local HTTPS registry test validates recipient token use, missing credential rejection, locked tarball download, changed integrity rejection, and cross-origin refusal. An external private registry deployment has not been tested.

Automated regression covers Home, directory lifecycle, Browser Companion, LAN Share HTTP/mux guards, Settings CAS, deferred state, signatures, consent binding, dependency closure, native install/rollback/reuse, and restart states. Broader human desktop smoke for all official inner pages and LAN workflows remains a release gate.

## Exact private trial artifact

Directory: releases/alpha17.2-private. The archive is named with its SHA-256 prefix to avoid stale same-version package cache. candidate.json records the actual filename, timestamps, size, SHA-256/SHA-512, extracted manifest identity, Creator templates, Host/Client byte checks and all build-input digests. The real installation evidence is bound to that exact archive hash.

The directory separates source test logs, build/typecheck logs, installation/restoration evidence, network trace and screenshots. This is an experimental private trial, not a stable release. See DISTRIBUTION-17.2.zh-CN.md for supported modes and limitations.

## Acceptance harness notes

Intermediate attempts encountered a native first-run login overlay and an intentionally interrupted pending import. The harness now waits for the overlay and the actual restart-required state. The interruption exposed and fixed a reconnect case: persisted consent now enters an installing state with a Continue action, avoiding another confirmation. Only the final exact-hash successful run is used as current delivery evidence.

---

## Historical Alpha.17.1 validation record

Candidate: `dsh-bay-0.2.2-alpha.17.1-dsh-0.2.1-rc.5`

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
| Core test suite, including Home and directory coverage | passed by `pnpm test`: 101 files / 613 tests |

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

## Private trial package

The old `releases/alpha17-private/dsh-workbench-core-0.2.2-alpha.17.tgz`
predates the Home implementation. Its bundled client does not match the Home
build; it must not be used to test 17.1. It is retained as historical evidence.

For the explicitly requested private trial, the runtime was rebuilt with
`pnpm build`, declarations were refreshed by the failing `pnpm typecheck`
attempt, and `pnpm pack --out` was run from `packages/workbench-core` to
produce the separate artifact:

`releases/alpha17.1-private/dsh-workbench-core-0.2.2-alpha.17.1.tgz`

This trial packaging step does not pass or disable the strict `pnpm pack:core`
release gate. The package remains experimental. Its `candidate.json` records
the actual archive timestamp, size, SHA-256 and SHA-512, validation results,
and archive-content checks. The archive manifest and build identity must both
be 17.1; bundled runtime files must match the rebuilt files byte-for-byte;
Home source hashes in `lib/build-inputs.json` must match the current sources.
The adjacent `tests.log`, `build.log` and `typecheck.log` retain this run's
verification output.

The candidate state is `private-staging / experimental-unvalidated`. A real
DSH rc5 desktop smoke, including official inner pages, Area/session binding,
minimum footprint behavior, More isolation and LAN Share, remains a release
gate.
