# Contributing to AreaDeck

This repository is private staging for the AreaDeck Core candidate. Before a
public contribution workflow is opened, changes must preserve the Core-only
delivery boundary and the DSH `0.2.1-rc.5` contract.

Every change should state:

- the user-visible behavior;
- the DSH surface or Workbench seam it touches;
- whether the change affects Area layout, Session binding, native projection or
  artifact identity;
- the validation command and result.

Do not add a second Plugin Manager, consume the official More menu in the
Workbench projection, or change the 15.1 inner-page space algorithm as part of
an rc5 compatibility update.
