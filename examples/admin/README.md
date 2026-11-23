# Admin and me example

One script that uses two of Odudu's clients: `@odudu-io/admin-client` as a service, and `@odudu-io/me-client` as a person. It is one file, `admin.ts`.

## What happens

1. The script signs in as the service `example-admin`, with its secret, using the token source of `@odudu-io/oidc`. The token names the admin API as its audience, and the service may do there what the admin capabilities of its account allow, which here is `manage-clients` and nothing more.
2. With `createAdminClient` it makes a client, walks the tenant's list of clients with `iterate` until it finds it, and deletes it, so the script can run again. The calls are the admin API's own paths without the tenant, which the client adds.
3. It then asks a person to sign in. It prints an address, listens on `http://127.0.0.1:8086/callback` for the answer, and finishes the sign-in with PKCE, as a command-line tool does. The sign-in asks for the person's own account, which `beginSignIn` does with `meAccess: 'read'`.
4. With `createMeClient` and the token for the me API, it reads the person's profile.

The two halves use different tokens because they are different callers: the admin API is for services and administrators, and the me API is for a person reading their own account, so a service has no profile to read. The me part needs a person at a browser, so the test is that person.

## Run it

You need Node 24 or later and the quick start stack. Run `../_shared/provision.sh` once: it makes the service `example-admin` with `odudu seed client --capability manage-clients`, which gives its account that capability, makes the client `example-admin-cli` the person signs in with, and makes the person `ada`.

Run `npm install`. To run it against a checkout of this repository instead, for a change that is not released yet, use `../_shared/install.sh . oidc admin-client me-client` in place of `npm install`; it builds and packs the SDKs and installs the result, and needs `pnpm install` run once at the repository root. Then:

```text
npm start
```

Open the address it prints and sign in as `ada`, whose password is `a long and unremarkable passphrase`. `npm test` runs the script and signs the person in with the repository's Playwright, then checks what it printed and that the client it made is gone.

## In a real tenant

`--capability` is how the first service gets a capability, because the admin API gives one only to a caller that already holds one. After that an administrator changes what an account holds with an admin token: `PUT /admin/tenants/<tenant>/subjects/<id>/roles`, which replaces the subject's roles and needs the `If-Match` header of the matching `GET`. The `id` is the subject of the client's service account, and the roles are those of the `odudu-admin` client, one for each capability.

## What is only for the example

The secret has a published default for the local stack. Read yours from the environment of the machine the service runs on. The SDKs are told to accept an http issuer, which a production script never does.
