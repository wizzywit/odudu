# signing-key

What more than one area reads of a tenant's signing keys: the key as the
server states it, the page read of the list, the read of all of it, and the
rules about when a rotating key may be promoted.

## Rules owned

- When a rotating key is ready to promote: published longer than the longest
  token any client may have plus a five-minute margin, on the same algorithm
  as the active key, and newer than it. A rotating key older than the active
  one is taken to be the one a promotion demoted, a key to retire; one of
  another algorithm already signs for the clients that ask for it, so
  promoting it would change the algorithm of every token. The signing-keys page
  and the overview's "ready to promote" read the same rule (`readyToPromote`),
  and the page says why a key is not ready (`promotionOf`).
- What a key published in the JWKS is called when the list does not say:
  `unlisted` when it is absent from a list that was read, `unknown` when the
  list could not be read (`publishedLane`).
- A tenant holds a handful of keys: reading all of them follows the cursor for
  at most ten pages and then reports a defect rather than looping.

Imports `shared` only. Staging, promoting, retiring and deleting a key, and
every sentence a page says about one, are `pages/signing-keys`'s. A service
cannot import an entity index for values, so a page's services receive these
rules from the use-case that reads the entity.

`repository/keyCalls` and `use-cases/keyCalls` only re-export, so other slices
reach the adapter through a use-case. `adapter/fixtures/` holds response
bodies from the keys transcripts.
