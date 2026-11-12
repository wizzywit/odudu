---
title: 'DELETE /sessions'
description: 'Requires manage-sessions. Ends every live session in the tenant, each through the same endSession that DELETE /subjects/:id/sessions/:sid calls —…'
---

# `DELETE /sessions`

> **Not replayed after the device field.** A session in a block on this page now also carries `device`, which the blocks below do not show, because this page was captured before the field existed and has not been run again. [A session's device](../request-paths/the-me-api.md#a-sessions-device) is a live capture of it.

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
{"subjectId":"01a0ee8a-ca97-7a85-b36d-e23f6a8ae2d3","issuerTenantId":"01a0ee8a-c394-7b49-942b-3dea70a962e7","capabilities":["manage-sessions"],"crossTenant":false}
{"items":[{"id":"01a0ee8b-26ae-74b4-8598-c6ca2545c92f","subject_id":"01a0ee8a-c58a-716c-96a6-edcab4ca1a70","username":"grace","created_at":"2026-09-29T19:01:31.945Z","last_active_at":"2026-09-29T19:01:31.945Z","remembered":false,"client_ids":[]},{"id":"01a0ee8b-27fa-7271-bb21-8bf1dec2d0fa","subject_id":"01a0ee8a-c58a-716c-96a6-edcab4ca1a70","username":"grace","created_at":"2026-09-29T19:01:32.281Z","last_active_at":"2026-09-29T19:01:32.281Z","remembered":false,"client_ids":["ops-app"]},{"id":"01a0ee8b-28f4-79df-bbe5-95698666977b","subject_id":"01a0ee8a-c748-743d-b60e-9b0ed48221a3","username":"linus","created_at":"2026-09-29T19:01:32.530Z","last_active_at":"2026-09-29T19:01:32.530Z","remembered":false,"client_ids":["ops-app"]},{"id":"01a0ee8c-520e-7010-b273-0d3799401aea","subject_id":"01a0ee8a-c8f6-7450-b486-861a66a87684","username":"mona","created_at":"2026-09-29T19:02:48.588Z","last_active_at":"2026-09-29T19:02:48.588Z","remembered":false,"client_ids":["ops-app"]},{"id":"01a0ee8c-5369-74cc-9b41-6304c2990dbb","subject_id":"01a0ee8a-ca97-7a85-b36d-e23f6a8ae2d3","username":"sam","created_at":"2026-09-29T19:02:48.935Z","last_active_at":"2026-09-29T19:02:48.935Z","remembered":false,"client_ids":["odudu-admin"]}]}
{"ended":4,"remaining":0,"beyond_ceiling":1}
{"type":"about:blank","title":"Unauthorized","status":401,"instance":"01a0ee8c-5559-7b23-ac77-3108e2291fa2"}
{"items":[{"id":"01a0ee8c-520e-7010-b273-0d3799401aea","subject_id":"01a0ee8a-c8f6-7450-b486-861a66a87684","username":"mona","created_at":"2026-09-29T19:02:48.588Z","last_active_at":"2026-09-29T19:02:48.588Z","remembered":false,"client_ids":["ops-app"]}]}
{"items":[{"id":"01a0ee8c-5548-7fd9-8179-8d3d1320b981","occurred_at":"2026-09-29T19:02:49.371Z","event_type":"admin_mutation","action":"session.end_all","outcome":"allowed","actor_tenant_id":"01a0ee8a-c394-7b49-942b-3dea70a962e7","actor_subject_id":"01a0ee8a-ca97-7a85-b36d-e23f6a8ae2d3","actor_client_id":"01a0ee8a-c3a0-7429-ab4a-4ecef6baf694","actor_name":"sam","actor_origin":"tenant","resource_type":"tenant","resource_id":"01a0ee8a-c394-7b49-942b-3dea70a962e7","request_id":"01a0ee8c-550b-776a-8847-5fcfd763a5d1","ip":"172.22.0.1","detail":{"ended":4,"remaining":0,"beyond_ceiling":1}}]}
```

`sam`'s own session was one of the four, so his token is refused at once;
`mona`'s, beyond what `sam` holds, is the one left.
