# 0029 — A page's headers have one authority

**Status:** Accepted · 2026-09-18

## Context

Every HTML page Odudu renders to an end-user is supposed to leave through
one function that sets its security headers. There were two.

`packages/protocol-oidc/src/view/html-response.ts`'s `sendHtml` derives the
Content Security Policy from the page's own declared script (ADR 0018's
amendment). `packages/account/src/view/verification-html.ts`'s
`sendVerificationHtml` hand-copied that policy, with a comment correctly
explaining why it could not import the first: `html-response.ts` is a
protocol package's internal, and no feature reaches into another's
internals (CLAUDE.md, Layering).

The two had already diverged. `sendVerificationHtml` sent
`referrer-policy: no-referrer`, defence in depth for the query-string
tokens the verification pages carry; `sendHtml` did not. Each exit was
correct on its own terms and incomplete against the other's, which is what
a hand-copy guarantees over time.

## Decision

The header set becomes a pure function, `pageHeaders`, in `@odudu/kernel`.
Every package's reply wrapper becomes two lines that spread its result over
a `FastifyReply` — `sendHtml` and `sendVerificationHtml` keep existing, but
neither owns the policy any more. `referrer-policy: no-referrer` moves onto
every page, not only the verification ones: no page is harmed by it, and
the tokens it defends are not unique to that feature.

`kernel` can hold this because the function is pure. `sendHtml` takes a
`FastifyReply`; `kernel`'s dependencies are `uuidv7` and `zod` only,
deliberately transport-free (verified:
`sed -n '/"dependencies"/,/}/p' packages/kernel/package.json`,
2026-09-18). Splitting the policy from the reply is what lets the policy
live where every package can reach it without adding `fastify` to the one
package everything depends on.

`html-response.test.ts` gains the rule this task exists to create: no
`*-html.ts` and no route file, in any package's view layer, names
`content-security-policy`, `x-frame-options` or `referrer-policy` — except
the two files that spread `pageHeaders`' result. A lint test that only
knows a name is present cannot verify a _value_, but a third hand-copy
cannot appear undetected either.

## Consequences

- "One exit" is explicitly **not** what was promised. There remain two
  `send*` functions, because `FastifyReply` cannot live in `kernel`. The
  promise is one **authority**: both exits spread the same headers, and
  neither can drift from the other without also drifting from
  `pageHeaders`, which is unit-tested directly.
- A third package adding a rendered page writes its own two-line wrapper
  spreading `pageHeaders`, not a third hand-copy — the new exit test fails
  the build the moment it names a header itself instead.
- `kernel` stays transport-free. Every future header this policy needs
  (a new directive, a new page-level default) is a change to one function,
  reachable from every package without a new dependency edge.

## Alternatives rejected

- **Move `sendHtml` itself into `kernel`.** Would add `fastify` as a
  dependency of the package every other package depends on, for the sake
  of a two-line wrapper that already fits in the packages that need it.
- **A new `@odudu/web` package.** One function does not justify a package;
  `RenderedPage`, the type this function already consumes, lives in
  `kernel`.
- **Leave both exits and document the duplication.** This is the state
  the codebase was already in — a correct comment explaining why the
  duplication existed did not stop it from drifting.
