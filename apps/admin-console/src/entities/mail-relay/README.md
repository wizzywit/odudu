# mail-relay

What more than one area reads of the relay a tenant's mail goes through: the
record as the server states it, the read of it, and what "effective" says
about where the mail goes.

## Rules owned

- Whose relay actually sends a tenant's mail: its own row (`tenant`), else the
  deployment's sender (`deployment`), else nothing (`none`), in which case
  verification and reset mail is only written to the server's log. The
  settings page says so in a word and a tone (`effectiveLabel`,
  `effectiveTone`) and in a sentence (`effectiveReading`).
- Whether a tenant has a relay at all: anything but `none` (`hasRelay`). The
  overview raises "No mail relay" from this when verification or reset is on.
- The password is never read back: the record says only whether one is set.

Imports `shared` only. Saving, removing and testing a relay, the form and its
rules are `pages/email`'s. A service cannot import an entity index for values,
so a page's services receive these rules from the use-case that reads the
entity.

`repository/relayCalls` and `use-cases/relayCalls` only re-export, so other
slices reach the adapter through a use-case. The adapter test reads two bodies
of the SMTP transcript verbatim.
