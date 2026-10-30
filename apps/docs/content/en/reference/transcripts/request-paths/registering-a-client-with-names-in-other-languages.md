---
title: 'Registering a client with names in other languages'
description: 'client_name#fr on dynamic registration: kept when the tenant offers the language, dropped when it does not, refused when malformed.'
---

# Registering a client with names in other languages

A dynamic registration may name the client in other languages with
`client_name#<tag>` members (RFC 7591 §2.2), which the consent page and the
sign-in page use when the person's language has one. [Bootstrap](./bootstrap.md#dynamic-client-registration)
shows the registration itself. A well-formed tag the tenant offers is stored and
echoed; one it does not offer is dropped and not echoed; a malformed tag, or one
written twice, is refused as `invalid_client_metadata` without repeating the
member's name.

Everything below ran in one session on a freshly built stack with `odudu seed admin
--username ada` run against it and `$ADMIN_TOKEN` got as in [Getting the
token](../admin-paths/getting-the-token.md). The tenant `reg-lang` is created with
registration open and `en` and `fr` offered:

```bash
A="Authorization: Bearer $ADMIN_TOKEN"; J='Content-Type: application/json'
curl -sS -X POST -H "$A" -H "$J" -d '{"name":"reg-lang"}' http://localhost:3000/admin/tenants -o /dev/null
curl -sS -X PATCH -H "$A" -H "$J" \
  -d '{"client_registration_policy":"open","supported_locales":["en","fr"]}' \
  http://localhost:3000/admin/tenants/reg-lang/settings | jq -c '{client_registration_policy, supported_locales}'
```

```bash
curl -sS -H "$A" http://localhost:3000/admin/tenants/reg-lang/settings | jq -c '{client_registration_policy, supported_locales}'
```

```
{"client_registration_policy":"open","supported_locales":["en","fr"]}
```

`client_name#fr` is kept and `client_name#de` is dropped, because `de` is not
offered:

```bash
curl -sS -X POST http://localhost:3000/tenants/reg-lang/clients-registrations/openid-connect \
  -H 'content-type: application/json' \
  -d '{"redirect_uris":["https://rp.example/cb"],"client_name":"Example RP","client_name#fr":"RP d’exemple","client_name#de":"Beispiel-RP"}'
echo
```

```
{"client_id":"01a18732-e839-7dfc-830f-4d5abee839e2","client_id_issued_at":1793269622,"client_secret":"ZNmZzx9adnYrclf6yNNgryFxk7r6EXhRDS5JtI21UDs","client_secret_expires_at":0,"redirect_uris":["https://rp.example/cb"],"grant_types":["authorization_code"],"token_endpoint_auth_method":"client_secret_basic","client_name":"Example RP","client_name#fr":"RP d’exemple"}
```

The client's own read shows what was kept:

```bash
curl -sS -H "$A" "http://localhost:3000/admin/tenants/reg-lang/clients?name=Example" | jq -c '.items[] | {name, name_i18n}'
```

```
{"name":"Example RP","name_i18n":{"fr":"RP d’exemple"}}
```

A malformed tag and a tag written twice (`fr` and `FR` are one tag) are each
refused:

```bash
curl -sS -X POST http://localhost:3000/tenants/reg-lang/clients-registrations/openid-connect \
  -H 'content-type: application/json' \
  -d '{"redirect_uris":["https://rp.example/cb"],"client_name#f":"RP"}'
echo
curl -sS -X POST http://localhost:3000/tenants/reg-lang/clients-registrations/openid-connect \
  -H 'content-type: application/json' \
  -d '{"redirect_uris":["https://rp.example/cb"],"client_name#fr":"RP","client_name#FR":"RP"}'
echo
```

```
{"error":"invalid_client_metadata","error_description":"a client_name#<language> member does not name a language tag"}
{"error":"invalid_client_metadata","error_description":"client_name#<language> names one language more than once"}
```
