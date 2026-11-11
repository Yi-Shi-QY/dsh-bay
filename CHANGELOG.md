# Changelog

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
  DSH Bay / 湾域 repository.
- Preserved the Workbench 15.1 inner-page space algorithm.
- Kept official More official-only and Conversation Suite deferred.
- Added repository-level provenance and private staging documentation.
