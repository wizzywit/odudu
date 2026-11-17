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
  "$P/clients/01a1e3b5-2675-7b50-ab51-36faab2db72d/sessions"; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$P/sessions/count?client=01a1e3b5-2675-7b50-ab51-36faab2db72d"; echo
```

```
{"count":3,"capped":false}
HTTP/1.1 200 OK
x-request-id: 01a1e3b5-4a56-7ec1-b385-153c982758a7
cache-control: no-store
link: </admin/tenants/ops-demo/sessions?limit=2&cursor=eyJhZnRlciI6IjAxYTFlM2I1LTI3N2ItNzViYy04NjZiLTA1ZmE4ZjhhYzQyNyIsImNvbGxlY3Rpb24iOiJ0ZW5hbnQtc2Vzc2lvbnMiLCJ0ZW5hbnRJZCI6IjAxYTFlM2I1LTI0MTgtNzcwZi05MjE5LWYxMzc2YTg0YzgxZSIsImZpbHRlcnMiOiJUMVBOb1l3cnFnd0RWTHRmbWo3TDVlMFNxMDJPRWJxSFBDOFJGaElDdVVVIn0.0Y55IYJ-K-DH2EodPTnTPWnLKKHqYhvTJWp5RVgyINo>; rel="next"
content-type: application/json; charset=utf-8
content-length: 945
Date: Mon, 16 Nov 2026 09:34:31 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a1e3b5-26f5-797d-a4ae-0ef007975bd6","subject_id":"01a1e3b5-2610-79f8-858b-fcef9dd3e298","username":"grace","created_at":"2026-11-16T09:34:22.450Z","last_active_at":"2026-11-16T09:34:22.450Z","remembered":false,"client_ids":[],"device":"3aa875d6c7062f784f6c7ea4cfb590db8fd3f0e993695d84e944aba074a09edc"},{"id":"01a1e3b5-277b-75bc-866b-05fa8f8ac427","subject_id":"01a1e3b5-2610-79f8-858b-fcef9dd3e298","username":"grace","created_at":"2026-11-16T09:34:22.585Z","last_active_at":"2026-11-16T09:34:22.585Z","remembered":false,"client_ids":["ops-app"],"device":"73f3bef45ab1c19ed909fecc2c6bff9ff604f3ac83a17b887cfa45ade818acf2"}],"next":"eyJhZnRlciI6IjAxYTFlM2I1LTI3N2ItNzViYy04NjZiLTA1ZmE4ZjhhYzQyNyIsImNvbGxlY3Rpb24iOiJ0ZW5hbnQtc2Vzc2lvbnMiLCJ0ZW5hbnRJZCI6IjAxYTFlM2I1LTI0MTgtNzcwZi05MjE5LWYxMzc2YTg0YzgxZSIsImZpbHRlcnMiOiJUMVBOb1l3cnFnd0RWTHRmbWo3TDVlMFNxMDJPRWJxSFBDOFJGaElDdVVVIn0.0Y55IYJ-K-DH2EodPTnTPWnLKKHqYhvTJWp5RVgyINo"}
{"items":[{"id":"01a1e3b5-277b-75bc-866b-05fa8f8ac427","subject_id":"01a1e3b5-2610-79f8-858b-fcef9dd3e298","username":"grace","created_at":"2026-11-16T09:34:22.585Z","last_active_at":"2026-11-16T09:34:22.585Z","remembered":false,"client_ids":["ops-app"],"device":"73f3bef45ab1c19ed909fecc2c6bff9ff604f3ac83a17b887cfa45ade818acf2"},{"id":"01a1e3b5-280d-7bb1-bd63-a40e80f3cbf2","subject_id":"01a1e3b5-2610-79f8-858b-fcef9dd3e298","username":"grace","created_at":"2026-11-16T09:34:22.730Z","last_active_at":"2026-11-16T09:34:22.730Z","remembered":false,"client_ids":["ops-app"],"device":"23c8d2ca97b47154399e89e9ea263ec00be48a3467f8e47b1eb78014c78b0395"}]}
{"count":2,"capped":false}
```

The first of `grace`'s sessions names no client: that sign-in asked for
`offline_access`, and its grant is bound to no session, so neither `client_ids`
nor `?client=` finds it there.

Each session also carries `device`, an opaque id shared by the sessions
opened on one browser (`null` for one opened before it was recorded), as the
blocks above show. [A session's device](../request-paths/the-me-api.md#a-sessions-device) runs it.
