# Changelog

## Unreleased

- Add a machine-readable DSH and direct dependency provenance map covering
  declared packages, host-provided closure, official resource identities and
  copied upstream source.
- Add `check:dsh-dependencies` and run it from `pnpm verify`; unclassified DSH
  package literals and dependency manifest drift now fail before compatibility
  checks.
- Move DSH dependency provenance into `tools/dsh-adaptation/` and add an offline
  and remote Git/npm drift scanner with optional JSON output and strict mode.
- Map upstream package paths to Bay consumers and verification steps, compare
  npm tarball integrity to lockfile baselines, and archive weekly scan reports.

## 0.2.2-alpha.18.7 — Assembled agents

- Add the Agent assembly drawer. A person builds an agent from DSH blocks
  (AGENTS.md, terminal, files, web, skill, agent loop), workbench tools and
  extra instructions; tool integration is now a tab inside it.
- Save every revision as `.bay/agents/<agentId>@<revision>.json`. Saving no
  longer registers; a person picks which revisions are live DSH modes, and the
  choice is kept in `.bay/agents/selection.json` and replayed on Host start.
- Unregistering a revision that sessions still use lists those sessions.
  Revisions whose tools left the catalog show as unavailable and cannot be
  registered.
- Bay Agent dispatch offers only the current workbench's registered agents.
  LAN guests also lose agents whose guest access is `none`, and cannot save,
  register or export agents.
- Complete packages register imported agents right after publication and move
  `bay:<workbench>:` preset ids in the session catalog, session headers,
  `agent-preset/selected` events and task snapshots to the new workbench id.
- Template packages carry assembled agents and their registration choice in
  `workbench.json`. Imports (template and complete) only record the source's
  choice as a suggestion; the receiving person registers. Unsigned layout-only
  packages are flagged.
- Add the Host `workbenchAgentKit` service. Extensions register tool and skill
  executors there; Core mounts only the entries an assembled revision selected
  into that agent's own scope. A revision whose selected entries have no Host
  executor cannot be registered.
- Filter `agentPresets/list` and check `agentPresets/select` and
  `create-session` for browser owners and LAN guests, so the native picker
  cannot reach other workbenches' or guest-blocked agents.
- Register assembled presets before Bay Agent resolves native sessions.
- Unregister warnings also list unfinished tasks. Stored definitions are
  validated strictly instead of being repaired.
- 18.6 and earlier reject 18.7 template packages that carry agents.

## 0.2.2-alpha.18.6 — Workbench archive lifecycle

- Allow the DSH desktop to restore or remove archived workbenches through the
  directory route while preserving browser-control and snapshot barriers.
- Limit the archived-record authorization to restore and remove transitions;
  ordinary edits remain denied. Cover the full lifecycle in an end-to-end test.

## 0.2.2-alpha.18.5 — Workbench lifecycle recovery

- Make browser ownership visible in the Workbench overview even when the
  Workbench is archived; disable restore until the browser lease is reclaimed.
- Add reclaim controls to the overview card and detail, show actionable reclaim
  errors, and cover successful and timed-out reclaim before restore.

## 0.2.2-alpha.18.4 — RC2 native Area page fixes

- Rebased the private Area renderer to RC2. Preserve Conversation content inside
  HOC slots (including missing or failing decorative layers), keyed Markdown
  fence wrappers, inline slot anchors, and keyed source member selection.
- Bind nested Subagent Chat stores to their child Session, preserve keyless root
  stores, and recover Conversation Factories that register after an Area mounts.
- Recover schedule task navigation from its durable Area resource address without
  depending on the official Sidebar's local tab history.
- Added tests using real RC2 Conversation and Subagent components, audited all
  nine stable native Sidebar types, and included private renderer hashes in
  `check:compat`. Desktop and second-device acceptance remain separate checks.

## 0.2.2-alpha.18.3 — private RC2 candidate

- Rebased the private Core candidate to DSH `0.2.2-rc.2`; kept the root build
  dependency and lockfile resolution pinned to RC2 while declaring the same
  `>=0.2.2-rc.2 <0.2.3` range for DSH peers and `engines.dsh`. Recorded the
  upstream tag, npm artifact integrity values, source index and candidate identity.
- Rebased the copied Sidebar and Workspace UI to RC2, including the new menu
  `anchorRef` contract, PanelIcon slot and long-list scroll handoff. Preserved
  Area-local Session routing and removed unused RC1 runtime files.
- Kept RC1 V3 layout and V4 Workbench data archives importable after their
  schema, digest, signature and Core compatibility checks. Executable RC1
  extension artifacts remain incompatible and must be rebuilt for RC2.
- Declared `engines.dsh` as `>=0.2.2-rc.2 <0.2.3`, accepting RC2 and later
  `0.2.2` prereleases and release while keeping build dependencies pinned.
- Normalized line endings in the RC1 historical source audit; all 34 indexed
  files match their LF hashes, and the aggregate historical digest also matches.
- Updated the bundled Creator guide for RC2 named and nested SubAgents and
  native per-Session AgentTeam opt-in. Bay Agent Assignments remain independent.
- Added current compatibility and source-integrity checks; separated RC1
  historical metadata checks and corrected the CRLF-only false mismatch report.
- This candidate is private. npm publication, Git tag and GitHub Release were
  not created. Desktop and second-device acceptance remain pending.

- Consolidated offline sharing into Complete Workbench and Workbench Template
  exports, with one import picker that detects V5/V6 complete archives and V4
  template archives. Both import histories now return to the correct workflow.
- Template imports create a new folder-backed Workbench without opening it or
  changing the current Workbench. Folder publication and deferred page-state
  restoration use the Host directory, with durable retry and revision checks.
- Template export optionally includes human-written Workbench background and
  omits model choices and task progress. Extension delivery remains a secondary
  choice: prepare locally, fetch exact dependencies, or embed approved artifacts.
- Import checks show required and installed extension versions. Different
  versions or builds are never silently replaced; missing template page state
  stays available for restoration after exact dependencies are ready.

- Fixed a LAN guest's Workbench page turning into garbled text on reload. The
  share gateway forwarded the browser's `accept-encoding` when it re-fetched
  the Workbench document, so DSH returned gzip that the gateway then decoded as
  UTF-8. The document is now always requested uncompressed and decoded
  defensively.
- Kept LAN guests from silently going stale. A guest that had not yet
  published detailed presence sent no heartbeat, so the Host presence TTL
  marked it lost and refused its next commands. The collaboration client now
  always heartbeats, recovers after its caller reconnects it, and the gateway
  terminates a collaboration socket that stops answering pings.
- Collaboration participants, including "… 已失联", are reported only in the
  Workbench top bar status area instead of an extra participant row; the
  conversation presence bar shows only participants who are present.
- Fixed a garbled Chinese error message for a session-less guest mutation.
- Fixed a LAN guest's new conversation showing as unavailable until reload.
  DSH announces a new Session before the Host records it in the shared
  Workbench, so the guest missed it; the Workbench now refreshes the Session
  catalog once and retains the Session from the refreshed list.
- Session markers (label and colour) are the same on every surface. The
  browser owner and LAN participants receive this Workbench's markers from the
  Host, missing markers are completed by the Host against the whole Workspace,
  a Session created through the Host gets its marker immediately, and marker
  edits from browser surfaces are saved on the Host.
- The floating workspace is shared through the collaboration session: its
  pages, the selected page and whether it is expanded. Window position and size
  stay on each screen. A refreshed page restores the shared floating workspace.
  Conversations started from the floating workspace are created through the
  Host so the Session belongs to the Workbench and LAN participants can use it.

- Localized the LAN sharing and permission dialogs into Chinese, clarified the
  shared scope and owner-only actions, and added selected and unavailable
  permission states. Narrow and short windows keep the action buttons visible
  while the permission list scrolls.
- Aligned the browser Workbench folder, shared-focus lock and share-permission
  controls with the existing 30px icon toolbar. Folder paths now open in an
  accessible popover without expanding the toolbar; active controls remain
  visible at narrow widths.
- Fixed the desktop Workbench canvas being squeezed into a thin strip after
  reclaiming a closed or disconnected browser page. The return status uses the
  existing Workbench toolbar only; no recovery panel is inserted above the canvas.

## 0.2.2-alpha.18.2 — private staging

- Joined the browser owner and the DSH desktop owner to the same Host
  collaboration session as LAN participants. A session is held per user, so
  stopping a share removes its participants without ending the owner's session.
- Replaced whole-text draft overwrites with a client OT adapter: unconfirmed
  local typing is transformed against remote operations, input method
  composition is never broadcast half finished, and nothing is submitted while
  the Host is unreachable.
- An accepted message now clears the shared draft of its Session for every
  participant as one Host operation.
- LAN participants render the owner's logical canvas size, scaled to their
  page. Remote cursors and selections are shown in the shared draft.
- Shared writes are refused while the collaboration is recovering or has
  ended, and the surface says which of the two it is.
- Hardened Host checks: symlink targets outside the Workbench root or inside
  `.bay` are refused, file write conflicts return `file-conflict`, and layout
  control leases cover the layout document and every split in it.
- LAN collaboration has passed automated tests only. It has not been run in a
  real DSH with a second device.

## 0.2.2-alpha.18.1 — private staging

- Added explicit desktop and browser-owner workbench surfaces with a shared
  browser takeover and reclaim lifecycle; kept DSH RC1 as the host authority.
- Added complete Workbench V6 export/import with extension locks, offline
  artifacts, preflight and staged recovery.
- Kept existing 18.0 extension declarations and V4/layout packages usable on
  the compatible 18.x line without changing the workbench folder format.
- Added recovery coverage for browser lifecycle, native Session portability,
  complete packages and previous 18.x package compatibility.
- Removed the retired guest projection/presence path and checkpointed the
  shared-control Host session, WebSocket, canvas and draft infrastructure.
  LAN collaboration remains in development and has not passed end-to-end
  acceptance; the single-workbench browser path stays independently usable.

## 0.2.2-alpha.18.0 — private staging

- Added directory-backed Workbenches, persistent Projects, project-local
  background and memory, and multiple explicitly bound Sessions per Area.
- Made Areas disposable project views. Closing an Area preserves its Project,
  conversations and tasks; reopening starts with the project overview.
- Added persistent Bay Main, native compaction, live Worker mode discovery,
  task continuation, orchestration checkpoints and durable report delivery.
- Added browser control handoff, progress-aware reclaim and recovery after
  direct tab closure; browser owners inherit the desktop extension settings.
- Added complete V5 packages with native history, attachments, project data,
  task snapshots, persistent jobs and separate data/environment/task reports.
- Refined the overview, native sidebar pinning, inner-page folders, Creator
  repair sessions, and creation/import UI with directory checks and retry.
- Updated the native Creator extension skill, templates and portable-state
  guidance for the Project/Area model.

Latest validated feature commit: `ab2a7d8`; private package validation records
162 test files and 1048 passing tests. See [validation](docs/VALIDATION.md) for
artifact hashes and outstanding real-device/model checks. No public release
or complete cross-platform acceptance is claimed.

Documentation maintenance on 2026-11-11 consolidated current guidance and
archived superseded plans. It does not change the previously delivered package.
The project handbook and user guide now document positioning, goals, current
capabilities, the proposed long-term roadmap, and the complete usage workflow.

## 0.2.2-alpha.17.6 - private staging

- Refined the Workbench container inner-page tab status indicators, tab
  metadata tooltips and unbound conversation empty state for hands-on UI
  validation.
- Added an in-page conversation binding button and unified conversation
  selection around the grouped picker with collapsible folders.
- Reworked inner-page and extension settings into compact responsive cards,
  with capsule switches and extension permissions managed inside each card.
- Moved tab text size and close-button preferences into Workbench settings.
- Kept the candidate pinned to DSH `0.2.2-rc.1` and refreshed the private
  staging package identity.

The candidate remains private staging for local installation testing.

## 0.2.2-alpha.17.5 — private staging

- Renamed the install package and client module to `dsh-bay`; the internal
  `workbench.core` module id remains available for migration compatibility.
- Rebased the tracked Sidebar/Workspace compatibility material on DSH
  `0.2.2-rc.1` and recorded the source, patch and lockfile digests.
- Consolidated the repository around one active RC1 candidate, one release
  record and one Core-only npm package.
- Added package-level README and MIT license files so the npm archive is
  self-describing.

The candidate remains private staging. DSH desktop smoke and public registry
publication are still release gates.

## 0.2.2-alpha.17 — private staging

- Extracted the Core-only DSH `0.2.2-rc.1` candidate into the independent
  DSH Bay / 湾 repository.
- Preserved the Workbench 15.1 inner-page space algorithm.
- Kept official More official-only and Conversation Suite deferred.
- Added repository-level provenance and private staging documentation.
