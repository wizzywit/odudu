# Architecture Decision Records

One file per decision. Format: context, decision, consequences,
alternatives rejected and why.

An ADR's decision is immutable once accepted. To reverse a decision, write
a new ADR that supersedes it.

A factual correction or amendment to an already-accepted ADR — a detail
that turns out to be wrong, or a refinement discovered while implementing
the same decision — is recorded in place, as a dated `## Correction` or
`## Amendment` section appended to the original file, rather than through a
superseding ADR. The correction is more valuable sitting next to the
reasoning it corrects than split into a separate file a reader has to find.
This is not an exception to immutability: the decision itself does not
change, and the original context, decision and consequences sections stay
as written. See ADR 0008, 0009 and 0013 for examples.
