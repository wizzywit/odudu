# OpenID Connect Back-Channel Logout 1.0

**Status in Odudu:** started in P2b, scoped for now to §2.1's `sid` claim —
the identifier a Logout Token will later need to name a session by.
`end_session_endpoint` now exists (RP-Initiated Logout 1.0, see
`docs/protocols/oidc-rpinitiated.md`) and ends the session `sid` names, but
the Logout Token itself and the back-channel delivery to a client's
registered logout URI are still P3 work. This table grows as each part
does, rather than being filled in ahead of the code.

## Clause table

| Clause | Level | Requirement                                                                                                                          | Test ID                   | Status  |
| ------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- | ------- |
| 2.1    | MUST  | the OP includes a `sid` Claim in the ID Token, identifying the End-User's session, so a Logout Token can later name the same session | `OIDC-BACKCHANNEL-2.1-01` | covered |
