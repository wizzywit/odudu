# OpenID Connect Back-Channel Logout 1.0

**Status in Odudu:** started in P2b, scoped for now to §2.1's `sid` claim —
the identifier a Logout Token will later need to name a session by — and
§2.7's revocation rule, which P2b's logout endpoint already has occasion to
follow even without the Logout Token itself. `end_session_endpoint` now
exists (RP-Initiated Logout 1.0, see `docs/protocols/oidc-rpinitiated.md`)
and ends the session `sid` names, but the Logout Token itself and the
back-channel delivery to a client's registered logout URI are still P3
work. This table grows as each part does, rather than being filled in
ahead of the code.

## Clause table

| Clause | Level  | Requirement                                                                                                                          | Test ID                    | Status  |
| ------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- | ------- |
| 2.1    | MUST   | the OP includes a `sid` Claim in the ID Token, identifying the End-User's session, so a Logout Token can later name the same session | `OIDC-BACKCHANNEL-2.1-01`  | covered |
| 2.7    | SHOULD | refresh tokens issued without the `offline_access` property to a session being logged out are revoked                                | `ODUDU-BACKCHANNEL-2.7-01` | covered |
| 2.7    | SHOULD | refresh tokens issued with the `offline_access` property are not revoked when the session that issued them is logged out             | `ODUDU-BACKCHANNEL-2.7-02` | covered |

## Reading note

### §2.7's two SHOULDs are one sentence, and Odudu keeps both halves

> Refresh tokens issued without the `offline_access` property to a session
> being logged out SHOULD be revoked. Refresh tokens issued with the
> `offline_access` property normally SHOULD NOT be revoked.

`handleLogoutRequest`'s `endSession` (`packages/protocol-oidc/src/index.ts`)
revokes every grant whose `session_id` names the session being ended
(`tokenGrantRepository(tx).revokeForSession`) — the first sentence. It
reaches no further, because a grant's `session_id` is `NULL` exactly when
it was issued for the `offline_access` scope
(`packages/domain-realm/src/usecase/provision-defaults.ts`,
`packages/protocol-oidc/src/usecase/token-issuance.ts`): SQL equality never
matches `NULL`, so the same `UPDATE` that revokes every session-bound grant
leaves an offline one untouched by construction, not by a second check
written to exempt it — the second sentence follows from the first without
extra code. `packages/protocol-oidc/tests/grant-session-link.int.test.ts`
pins that at the repository layer; `logout.int.test.ts` and
`offline-access.int.test.ts` pin it end to end, through a real logout and a
real subsequent refresh.
