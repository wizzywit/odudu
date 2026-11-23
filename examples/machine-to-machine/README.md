# Machine-to-machine example

A service that is not a person: a nightly job, or a backend calling another backend. It signs in as itself with a secret, gets an access token, and calls the [API example](../api) with it. This example is one file, `client.ts`, and has one dependency, the `@odudu-io/oidc` SDK, whose token source keeps the token and renews it.

## What happens

1. The service sends its client id and secret to the tenant's token endpoint, in the `Authorization` header (`client_secret_basic`), and asks for the `client_credentials` grant.
2. Odudu answers with an access token that lasts five minutes. There is no refresh token and no ID token, because nobody signed in. The service keeps the token and reuses it until 30 seconds before it expires, then asks again with the credentials it already holds.
3. The service calls the API with the token, asking for the `reports:read` scope that its registration allows, and prints what came back.

## Run it

You need Node 24 or later, the quick start stack and the API example running. Run `../_shared/provision.sh` once, start the API in `../api` (see its README), then here:

```text
npm install
npm start
```

`npm test` also needs the API installed: run `npm install` in `../api` too. To run it against a checkout of this repository instead, for a change that is not released yet, use `../_shared/install.sh . oidc` in place of `npm install`; it builds and packs the SDKs and installs the result, and needs `pnpm install` run once at the repository root. The API takes `../_shared/install.sh ../api node`.

`npm test` starts the API itself, runs the client and checks that it is answered, checks that a wrong secret is refused, and checks that the token is asked for once and asked for again only when it is nearly expired.

## What is only for the example

The secret has a published default for the local stack. Read yours from the environment of the machine the service runs on.
