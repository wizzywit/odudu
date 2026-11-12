---
title: "A subject's accepted terms: read"
description: "Reading the versions of the tenant's terms a subject accepted requires view-users."
---

# A subject's accepted terms: read

This page covers `GET /subjects/:id/terms-acceptances`.

It requires `view-users`. It lists the versions of the tenant's terms the subject accepted through the `accept-terms` required action
and when, newest first. It is paged by keyset on the time and the version: `limit` takes up to 200, and `next`, also the `link`
header, names the following page; a response with no `next` is the last. A subject that has accepted nothing answers an empty list,
and a subject that does not exist, `404`. A `cursor` that this server did not write is refused with `400`.

On `grace`, who accepted `2026-02` and then `2026-03` in [the run of the sign-in pages](../request-paths/more-required-actions.md#the-terms):

```bash
S=$BASE/admin/tenants/more-demo/subjects
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" $S/$GRACE/terms-acceptances
```

```
HTTP/1.1 200 OK
x-request-id: 01a1d202-d3f2-7d80-82c3-15f504080474
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 137
Date: Thu, 12 Nov 2026 23:06:03 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"version":"2026-03","accepted_at":"2026-11-12T23:06:02.355Z"},{"version":"2026-02","accepted_at":"2026-11-12T23:06:01.045Z"}]}
```

One to a page, then the second page by its cursor, `lin`, who accepted nothing, a cursor that is not ours, and a subject that does not exist:

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" "$S/$GRACE/terms-acceptances?limit=1" | tee page1.txt
NEXT=$(tail -1 page1.txt | jq -r .next)
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$S/$GRACE/terms-acceptances?limit=1&cursor=$NEXT"
echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$S/$LIN/terms-acceptances"
echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$S/$GRACE/terms-acceptances?cursor=nonsense"
echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$S/01a1d1ba-0000-7000-8000-000000000000/terms-acceptances"
echo
```

```
HTTP/1.1 200 OK
x-request-id: 01a1d202-d40e-775a-ac17-09b078264ccd
cache-control: no-store
link: </admin/tenants/more-demo/subjects/01a1d202-aadf-79f5-a8b2-bb9c647a6a1c/terms-acceptances?limit=1&cursor=eyJhZnRlciI6IltcIjIwMjYtMTEtMTJUMjM6MDY6MDIuMzU1WlwiLFwiMjAyNi0wM1wiXSIsImNvbGxlY3Rpb24iOiJ0ZXJtcy1hY2NlcHRhbmNlcyIsInRlbmFudElkIjoiMDFhMWQyMDItYWEzYy03NDcwLWIzMGUtMDQ5NGQ4OTAyZDk0IiwiZmlsdGVycyI6IjJkWnVTd0NKTzctaFRMQTg5ZXFaSEZCUTVHeHpzb0ZhSERmZHRHZVBCc28ifQ.DGeSLR9YW7yb9x1E02R5jnJGYKd6zVcZBXVbHdXY3jE>; rel="next"
content-type: application/json; charset=utf-8
content-length: 386
Date: Thu, 12 Nov 2026 23:06:03 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"version":"2026-03","accepted_at":"2026-11-12T23:06:02.355Z"}],"next":"eyJhZnRlciI6IltcIjIwMjYtMTEtMTJUMjM6MDY6MDIuMzU1WlwiLFwiMjAyNi0wM1wiXSIsImNvbGxlY3Rpb24iOiJ0ZXJtcy1hY2NlcHRhbmNlcyIsInRlbmFudElkIjoiMDFhMWQyMDItYWEzYy03NDcwLWIzMGUtMDQ5NGQ4OTAyZDk0IiwiZmlsdGVycyI6IjJkWnVTd0NKTzctaFRMQTg5ZXFaSEZCUTVHeHpzb0ZhSERmZHRHZVBCc28ifQ.DGeSLR9YW7yb9x1E02R5jnJGYKd6zVcZBXVbHdXY3jE"}{"items":[{"version":"2026-02","accepted_at":"2026-11-12T23:06:01.045Z"}]}
{"items":[]}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"cursor is invalid or expired","errors":[{"path":"cursor","message":"is invalid or expired"}],"instance":"01a1d202-d455-776a-920f-33599c5cc175"}
{"type":"about:blank","title":"Not Found","status":404,"detail":"no subject 01a1d1ba-0000-7000-8000-000000000000","instance":"01a1d202-d468-7193-b6c6-e4b7c0892028"}
```
