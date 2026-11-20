# Machine-to-machine example

A service that is not a person: a nightly job, or a backend calling another backend. It signs in as itself with a secret, gets an access token, and calls the [API example](../api) with it. This example is one file, `client.ts`, and has one dependency, the `@odudu-io/oidc` SDK, whose token source keeps the token and renews it.

## What happens

1. The service sends its client id and secret to the tenant's token endpoint, in the `Authorization` header (`client_secret_basic`), and asks for the `client_credentials` grant.
2. Odudu answers with an access token that lasts five minutes. There is no refresh token and no ID token, because nobody signed in. The service keeps the token and reuses it until 30 seconds before it expires, then asks again with the credentials it already holds.
3. The service calls the API with the token, asking for the `reports:read` scope that its registration allows, and prints what came back.

## Run it

You need Node 24 or later, the quick start stack and the API example running. Run `../_shared/provision.sh` once, start the API in `../api` (see its README), then here:

```text
../_shared/install.sh . oidc
npm start
```

The SDKs are not on npm yet, so `../_shared/install.sh` builds them from this repository and installs the packed result (it needs `pnpm install` run once at the repository root); `npm test` also needs the API installed, with `../_shared/install.sh ../api node`. Once the SDKs are published, `npm install` is all a copy of this folder needs.

`npm test` starts the API itself, runs the client and checks that it is answered, checks that a wrong secret is refused, and checks that the token is asked for once and asked for again only when it is nearly expired.

## What is only for the example

The secret has a published default for the local stack. Read yours from the environment of the machine the service runs on.
