# Release records

The current release tree contains only the active private candidate:

```text
alpha17.5-rc1-private/
```

It holds the candidate identity, package-name verification and local trial
artifact metadata for DSH Bay `0.2.2-alpha.17.5` on DSH `0.2.2-rc.1`.

Older alpha candidate records were removed from the tracked tree during the
repository cleanup. Their source history remains in Git and they are not
inputs to the current build. Generated `.tgz` files and local acceptance
evidence may remain under ignored paths; a public Release should attach only
the final artifact, checksums, changelog and compatibility record for that
version.
