# Release records

The tracked release directory retains historical candidate records. New private
candidate tarballs are generated into ignored release subdirectories and are
not public releases. The current RC2 candidate output is:

```text
alpha18.6-rc2-private/
```

It contains the private candidate package and generated `candidate.json` for
DSH Bay `0.2.2-alpha.18.6` on DSH `0.2.2-rc.2` after `pnpm pack:core` runs.

Validation records distinguish automated checks from DSH desktop and second
device acceptance.

Older alpha candidate records were removed from the tracked tree during the
repository cleanup. Their source history remains in Git and they are not
inputs to the current build. Generated `.tgz` files and local acceptance
evidence may remain under ignored paths; a public Release should attach only
the final artifact, checksums, changelog and compatibility record for that
version.
