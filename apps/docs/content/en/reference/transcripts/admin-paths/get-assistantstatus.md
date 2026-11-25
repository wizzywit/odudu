---
title: 'GET /assistant/status'
description: 'Whether the console assistant is on: an object with enabled false until a standard model is configured, then the models, modes and provider…'
---

# `GET /assistant/status`

Whether the console assistant is on in this deployment, for the console to decide whether to show it. It requires
`use-assistant`, one of the three assistant capabilities (`use-assistant`, `read-assistant-activity` and `manage-assistant`),
which `tenant-admin` carries. A caller without it is refused `403`, with a token for no tenant `401`, and an AI agent's token is
refused whatever it holds, since an agent reads nothing of the assistant that may be running it.

The answer is decided when the server starts, from `ODUDU_ASSISTANT_MODELS` and the variables of the providers it names.
With no `standard` slot that resolves it is `{"enabled":false}`. Otherwise it names the model each slot runs (a `fast` or `deep`
slot that is not set runs the `standard` model), the modes offered, the default mode, the distinct models in slot order and
the provider of the `standard` slot, with the host of a self-hosted endpoint for `openai-compatible` and nothing else of its
address. No key is ever in it. No other assistant path exists yet, so any other path under `/assistant/` is the ordinary `404`.

Both runs are on one stack, on port `3112`, from an empty volume. The tenant and its two clients are made with the CLI, and each client's
token is got with `client_credentials`:

```bash
docker compose -p odudu-p5c-i2 exec -T odudu node dist/main.js seed tenant --name assist-demo
docker compose -p odudu-p5c-i2 exec -T odudu node dist/main.js seed client --tenant assist-demo --client-id assist-user --client-secret assist-user-secret --grant-type client_credentials --audience urn:odudu:params:admin-api --capability use-assistant
docker compose -p odudu-p5c-i2 exec -T odudu node dist/main.js seed client --tenant assist-demo --client-id assist-viewer --client-secret assist-viewer-secret --grant-type client_credentials --audience urn:odudu:params:admin-api --capability view-users
```

```
{"command":"tenant","created":true,"tenant":"assist-demo","tenantId":"01a214d1-d3bc-7dc9-acf6-2b6f2988151e"}
{"command":"client","created":true,"tenant":"assist-demo","tenantId":"01a214d1-d3bc-7dc9-acf6-2b6f2988151e","clientId":"assist-user","clientDbId":"01a214d1-d6e8-7df6-af3a-4bb6bdde87fc","capabilities":["use-assistant"]}
{"command":"client","created":true,"tenant":"assist-demo","tenantId":"01a214d1-d3bc-7dc9-acf6-2b6f2988151e","clientId":"assist-viewer","clientDbId":"01a214d1-da52-716e-80f1-8dd130db1788","capabilities":["view-users"]}
```

## With no model configured

The stack as the compose file starts it, which sets none of the assistant's variables. `USER_TOKEN` is the `assist-user`
client's token and `VIEWER_TOKEN` the `assist-viewer`'s:

```bash
API=http://localhost:3112/admin/tenants/assist-demo
curl -sS -D - -H "Authorization: Bearer $USER_TOKEN" $API/assistant/status
curl -sS -D - -H "Authorization: Bearer $VIEWER_TOKEN" $API/assistant/status
curl -sS -D - $API/assistant/status
curl -sS -D - -H "Authorization: Bearer $USER_TOKEN" $API/assistant/settings
```

```
HTTP/1.1 200 OK
x-request-id: 01a214d1-f957-7d53-b271-d0e51614711c
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 17
Date: Wed, 25 Nov 2026 22:27:14 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"enabled":false}
HTTP/1.1 403 Forbidden
x-request-id: 01a214d1-f970-7b5d-9358-189ff6f963b8
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 105
Date: Wed, 25 Nov 2026 22:27:14 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Forbidden","status":403,"instance":"01a214d1-f970-7b5d-9358-189ff6f963b8"}
HTTP/1.1 401 Unauthorized
x-request-id: 01a214d1-f987-7b92-8722-bbc232de53a1
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 108
Date: Wed, 25 Nov 2026 22:27:14 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Unauthorized","status":401,"instance":"01a214d1-f987-7b92-8722-bbc232de53a1"}
HTTP/1.1 404 Not Found
x-request-id: 01a214d1-f995-733e-8d02-b6b4d384dcca
content-type: application/problem+json; charset=utf-8
content-length: 151
Date: Wed, 25 Nov 2026 22:27:14 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank#not-found","title":"Not Found","status":404,"detail":"No resource at this path","instance":"01a214d1-f995-733e-8d02-b6b4d384dcca"}
```

## With models configured

The same stack started again over the same volume with a second compose file that sets, on the `odudu` service,
`ODUDU_ASSISTANT_MODELS` to `standard=openai-compatible:llama3.3-70b,fast=openai-compatible:qwen3-8b,deep=anthropic:claude-opus-5`,
`ODUDU_ASSISTANT_OPENAI_COMPATIBLE_BASE_URL` to `http://gpu.internal:8000/v1` and `ANTHROPIC_API_KEY` to a placeholder. The
server logs `The assistant is on: standard slot runs openai-compatible:llama3.3-70b.` as it starts. The same request, with a
token got again:

```bash
curl -sS -D - -H "Authorization: Bearer $USER_TOKEN" $API/assistant/status
```

```
HTTP/1.1 200 OK
x-request-id: 01a214d2-60aa-7180-9020-3894677be514
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 261
Date: Wed, 25 Nov 2026 22:27:41 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"enabled":true,"slots":{"fast":"qwen3-8b","standard":"llama3.3-70b","deep":"claude-opus-5"},"modes":["ask","act"],"defaultMode":"ask","modelChoices":["qwen3-8b","llama3.3-70b","claude-opus-5"],"provider":{"kind":"openai-compatible","host":"gpu.internal:8000"}}
```

The address in the variable has a path, `/v1`; the answer carries the host and port only, and neither the placeholder key nor
any part of an address after the host.
