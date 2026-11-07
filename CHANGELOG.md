# Changelog

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
