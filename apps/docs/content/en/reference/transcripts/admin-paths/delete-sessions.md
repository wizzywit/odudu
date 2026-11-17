---
title: 'DELETE /sessions'
description: 'Requires manage-sessions. Ends every live session in the tenant, each through the same endSession that DELETE /subjects/:id/sessions/:sid calls —…'
---

# `DELETE /sessions`

Requires `manage-sessions`. Ends every live session in the tenant, each through
the same `endSession` that `DELETE /subjects/:id/sessions/:sid` calls — its
grants revoked, a Back-Channel Logout Token queued for each client that used it,
and its own `session.ended` row. A session whose subject holds an admin
capability the caller does not is left alone and counted under
`beyond_ceiling`: the target ceiling, run over the tenant as a set (ADR 0040,
whose consequence is that `manage-sessions` alone ends no administrator's
session; ADR 0040's amendment of 2026-09-30). One call ends at most 500
sessions, in id order, and answers how many are still live beyond those
under `remaining`, so a tenant with more is ended by calling again until
`remaining` is `0` — each call a transaction short enough not to hold the
tenant's sessions locked for the length of a large one. One
`session.end_all` row, filed on the tenant, carries all three counts. The
caller's own session ends with the rest when it is one of them.

After `sam`, granted `odudu-admin:manage-sessions` alone, signed in to the
tenant's own admin client (`$SAM_TOKEN`), and `mona` signed in through
`ops-app`:

```bash
curl -sS -H "Authorization: Bearer $SAM_TOKEN" "$P/whoami"; echo
curl -sS -H "Authorization: Bearer $SAM_TOKEN" "$P/sessions"; echo
curl -sS -X DELETE -H "Authorization: Bearer $SAM_TOKEN" "$P/sessions"; echo
curl -sS -H "Authorization: Bearer $SAM_TOKEN" "$P/sessions"; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/sessions"; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/audit?action=session.end_all&limit=1"; echo
```

```
{"subjectId":"01a1d0a5-8e0e-7f9e-b5c2-599cee459012","issuerTenantId":"01a1d0a5-8552-7171-b1d9-4e0a987997fe","issuerTenantName":"sess-demo","capabilities":["manage-sessions"],"crossTenant":false}
{"items":[{"id":"01a1d0a5-91b5-7145-9a16-703b4c7b5d2d","subject_id":"01a1d0a5-891f-7911-9880-14b2bb4b88a3","username":"grace","created_at":"2026-11-12T16:44:34.098Z","last_active_at":"2026-11-12T16:44:34.098Z","remembered":false,"client_ids":[],"device":"48922f10740a10a209033f0b0bf36aeb49d915a03a5e301dce0a289878976e3e"},{"id":"01a1d0a5-9209-7bdd-b650-c72adf49dadb","subject_id":"01a1d0a5-891f-7911-9880-14b2bb4b88a3","username":"grace","created_at":"2026-11-12T16:44:34.183Z","last_active_at":"2026-11-12T16:44:34.183Z","remembered":false,"client_ids":["ops-app"],"device":"f6106b7e84eb1f0e09e9b7aea901c53e5db0ca907d3654d43a0002e1e97c8448"},{"id":"01a1d0a5-92ab-7a61-b1b0-37ce5c1ca936","subject_id":"01a1d0a5-8ac1-78d1-89b6-265f8d37c3e7","username":"linus","created_at":"2026-11-12T16:44:34.345Z","last_active_at":"2026-11-12T16:44:34.345Z","remembered":false,"client_ids":["ops-app"],"device":"ebb2089678cc4fd3a90e848816baf00df8379c48ef4267ddbc02ca8c28083fa3"},{"id":"01a1d0a5-9327-7129-a2d4-6f6b811ae0a6","subject_id":"01a1d0a5-8c75-7205-b313-5ac44bebcd70","username":"mona","created_at":"2026-11-12T16:44:34.469Z","last_active_at":"2026-11-12T16:44:34.469Z","remembered":false,"client_ids":["ops-app"],"device":"0ab1f8d69ffa9471e85659d198b9c7782ab6e49c0d542236929d68c1e23645b0"},{"id":"01a1d0a5-9396-7c3b-8809-8d69bb516bd1","subject_id":"01a1d0a5-8e0e-7f9e-b5c2-599cee459012","username":"sam","created_at":"2026-11-12T16:44:34.580Z","last_active_at":"2026-11-12T16:44:34.580Z","remembered":false,"client_ids":["odudu-admin"],"device":"4e1c59c443622fbf30b43816278b302e66b067f37cb250f8481aef531e7136fc"}]}
{"ended":4,"remaining":0,"beyond_ceiling":1}
{"type":"about:blank","title":"Unauthorized","status":401,"instance":"01a1d0a5-95cd-7f34-b77c-289d43e78333"}
{"items":[{"id":"01a1d0a5-9327-7129-a2d4-6f6b811ae0a6","subject_id":"01a1d0a5-8c75-7205-b313-5ac44bebcd70","username":"mona","created_at":"2026-11-12T16:44:34.469Z","last_active_at":"2026-11-12T16:44:34.469Z","remembered":false,"client_ids":["ops-app"],"device":"0ab1f8d69ffa9471e85659d198b9c7782ab6e49c0d542236929d68c1e23645b0"}]}
{"items":[{"id":"01a1d0a5-95c0-7551-9a97-4e671b302d95","occurred_at":"2026-11-12T16:44:35.103Z","event_type":"admin_mutation","action":"session.end_all","outcome":"allowed","actor_tenant_id":"01a1d0a5-8552-7171-b1d9-4e0a987997fe","actor_subject_id":"01a1d0a5-8e0e-7f9e-b5c2-599cee459012","actor_client_id":"01a1d0a5-858e-7b73-88dd-0f285dbf2e4d","actor_name":"sam","actor_origin":"tenant","resource_type":"tenant","resource_id":"01a1d0a5-8552-7171-b1d9-4e0a987997fe","request_id":"01a1d0a5-9593-73ed-a1fe-dbb87c34a3d3","ip":"172.20.0.1","detail":{"ended":4,"remaining":0,"beyond_ceiling":1}}]}
```

`sam`'s own session was one of the four, so his token is refused at once;
`mona`'s, beyond what `sam` holds, is the one left.
