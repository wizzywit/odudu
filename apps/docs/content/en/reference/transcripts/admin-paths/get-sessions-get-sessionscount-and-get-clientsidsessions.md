---
title: "Sessions: list, count, and a client's sessions"
description: "Requires manage-sessions. Every live session in the tenant, whoever holds it, in id order and cursored, each naming its subject and that subject's…"
---

# Sessions: list, count, and a client's sessions

This page covers `GET /sessions`, `GET /sessions/count` and `GET /clients/:id/sessions`.

Requires `manage-sessions`. Every live session in the tenant, whoever holds
it, in id order and cursored, each naming its subject and that subject's
username. Liveness is the same arithmetic every other session read uses,
written as a predicate so a page is one query (`liveSessionCondition`,
`@odudu/authn-flows`). `?client=` narrows the listing, and the count, to the
sessions holding a grant through that client, by its row id;
`GET /clients/:id/sessions` is the same narrowing, answering `404` for a client
that does not exist. The count is capped like every other.

With the three sessions its sign-ins left:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/sessions/count"; echo
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" "$P/sessions?limit=2"; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$P/clients/01a0ee8a-d1a7-7c3c-a05b-903a2d8fa123/sessions"; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$P/sessions/count?client=01a0ee8a-d1a7-7c3c-a05b-903a2d8fa123"; echo
```

```
{"count":3,"capped":false}
HTTP/1.1 200 OK
x-request-id: 01a0ee8b-343a-7279-ad8e-e45c5b139fc1
cache-control: no-store
link: </admin/tenants/ops-demo/sessions?limit=2&cursor=eyJhZnRlciI6IjAxYTBlZThiLTI3ZmEtNzI3MS1iYjIxLThiZjFkZWMyZDBmYSIsImNvbGxlY3Rpb24iOiJ0ZW5hbnQtc2Vzc2lvbnMiLCJ0ZW5hbnRJZCI6IjAxYTBlZThhLWMzOTQtN2I0OS05NDJiLTNkZWE3MGE5NjJlNyIsImZpbHRlcnMiOiJUMVBOb1l3cnFnd0RWTHRmbWo3TDVlMFNxMDJPRWJxSFBDOFJGaElDdVVVIn0.TWjgj_zCkTnLF8x2j2neR72PFkSthAD4leDxqPxE6Wk>; rel="next"
content-type: application/json; charset=utf-8
content-length: 793
Date: Tue, 29 Sep 2026 19:01:35 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a0ee8b-26ae-74b4-8598-c6ca2545c92f","subject_id":"01a0ee8a-c58a-716c-96a6-edcab4ca1a70","username":"grace","created_at":"2026-09-29T19:01:31.945Z","last_active_at":"2026-09-29T19:01:31.945Z","remembered":false,"client_ids":[]},{"id":"01a0ee8b-27fa-7271-bb21-8bf1dec2d0fa","subject_id":"01a0ee8a-c58a-716c-96a6-edcab4ca1a70","username":"grace","created_at":"2026-09-29T19:01:32.281Z","last_active_at":"2026-09-29T19:01:32.281Z","remembered":false,"client_ids":["ops-app"]}],"next":"eyJhZnRlciI6IjAxYTBlZThiLTI3ZmEtNzI3MS1iYjIxLThiZjFkZWMyZDBmYSIsImNvbGxlY3Rpb24iOiJ0ZW5hbnQtc2Vzc2lvbnMiLCJ0ZW5hbnRJZCI6IjAxYTBlZThhLWMzOTQtN2I0OS05NDJiLTNkZWE3MGE5NjJlNyIsImZpbHRlcnMiOiJUMVBOb1l3cnFnd0RWTHRmbWo3TDVlMFNxMDJPRWJxSFBDOFJGaElDdVVVIn0.TWjgj_zCkTnLF8x2j2neR72PFkSthAD4leDxqPxE6Wk"}
{"items":[{"id":"01a0ee8b-27fa-7271-bb21-8bf1dec2d0fa","subject_id":"01a0ee8a-c58a-716c-96a6-edcab4ca1a70","username":"grace","created_at":"2026-09-29T19:01:32.281Z","last_active_at":"2026-09-29T19:01:32.281Z","remembered":false,"client_ids":["ops-app"]},{"id":"01a0ee8b-28f4-79df-bbe5-95698666977b","subject_id":"01a0ee8a-c748-743d-b60e-9b0ed48221a3","username":"linus","created_at":"2026-09-29T19:01:32.530Z","last_active_at":"2026-09-29T19:01:32.530Z","remembered":false,"client_ids":["ops-app"]}]}
{"count":2,"capped":false}
```

The first of `grace`'s sessions names no client: that sign-in asked for
`offline_access`, and its grant is bound to no session, so neither `client_ids`
nor `?client=` finds it there.

Each session now also carries `device`, an opaque id shared by the sessions
opened on one browser (`null` for one opened before it was recorded). The
blocks on this page were captured before it existed;
[A session's device](../request-paths/the-me-api.md#a-sessions-device) runs it.
