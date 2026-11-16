---
title: 'GET /console/api/session'
description: 'The console session endpoint answers with the tenant, subject and username of the signed-in administrator, and no token.'
---

# `GET /console/api/session`

```bash
curl -sS -D - -c jar -b jar http://localhost:3000/console/api/session
```

```
HTTP/1.1 200 OK
x-request-id: 01a1e40a-a1b9-74b3-aff1-708a9e1662f8
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 97
Date: Mon, 16 Nov 2026 11:07:44 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"tenant":"console-paths","subject_id":"01a1e40a-97ed-7c3e-844f-e4e718d05850","username":"grace"}
```
