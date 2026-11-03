# Changelog

All notable changes to Odudu are written here, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/) as [RELEASING.md](RELEASING.md) describes.

## [Unreleased]

## [0.1.0-rc.6] - 2026-11-03

The sixth release candidate. Odudu has had no independent security review.

### Changed

- The admin console's and the documentation site's source is reorganised into the folder layout the contributor documentation describes, with checks that keep it so. Nothing a person sees or calls changed: no route, request, wording or setting.

### Fixed

- Staging a signing key that the server refuses for the algorithm alone now shows the server's reason under the Algorithm control; before, nothing appeared beside the button.

## [0.1.0-rc.5] - 2026-11-01

The fifth release candidate. Odudu has had no independent security review.

### Added

- Every page the server shows, and its mail, can wear a tenant's theme and a client's branding: a light and a dark palette, a font, a logo, a dark logo, a favicon, a background image, a stylesheet and page templates. A client's pieces override the tenant's one piece at a time.
- A Branding area in the admin console, and a Branding tab on each client: a live preview in a sandboxed frame, a draft that is published as a numbered version, up to twenty versions kept, and Revert, Discard and Restore. On a phone the preview is a strip that opens as a sheet.
- Two administrators editing the same message override or theme see what changed and choose Keep mine or Take theirs, instead of overwriting each other.
- Pages and mail in English and Arabic, chosen per tenant, with the tenant's own wording for any message.
- Mail wears the tenant's logo and colours, and a client's over them when the sign-in began in that client, in a light and a dark look. The Email page can send a test mail as any client.
- Documentation for tenant and client branding, with a picture for each step in light and dark.

### Changed

- The admin API authenticates every request that carries a body before it reads the body, so an unauthenticated caller can no longer make the server buffer and validate a large body.
- A client's default scopes are listed in one fixed order, with `openid` first.

### Security

- Templates and stylesheets are checked before they are saved and again when served: a stylesheet cannot hide a needed part of a page, shrink it, wash it out or remove the focus outline, and a template cannot add its own form or script. Uploaded images are re-encoded, and brand and asset responses carry a sandboxing content security policy.
- A message override of the consent heading must keep the client's name.
- Every automatic message carries `Auto-Submitted: auto-generated`.
- The test mail takes one recipient, is rate limited, and says nothing of a failed relay's own text.

## [0.1.0-rc.4] - 2026-10-27

The fourth release candidate. Odudu has had no independent security review.

### Added

- Pages measured on every change against Core Web Vitals and Lighthouse budgets, so the documentation and the landing page stay fast.
- The landing page shows the pages people see when they sign in, and says what is planned for agents and branding.

### Changed

- Logout shows every front-channel logout frame before it redirects to a matched post-logout address.
- Code blocks in the documentation are coloured when the site is built, and read well in both themes.
- A stable tag must point at a commit on `main`, and `latest` moves only to the newest stable release.
- Every GitHub Action in the workflows is pinned to a commit, and Dependabot waits two days before it proposes a version.

### Fixed

- A password reset finds the account whatever the case of its address.
- Two sign-ups with the same address at the same moment can no longer both succeed.
- Failures are logged with their message and stack, and a verification form that failed now shows its page.

### Security

- A mailed link that sets a password now ends every session and token the person had, and proves the address.
- When an address is verified or changed, the account is no longer treated as self-registered. A reset removes authenticators and recovery codes only on an account that registered itself and was never verified.
- Logout tokens now name the address the request came to, and a server in production refuses to start when `ODUDU_TLS` and the `https` or `http` of the public base address disagree.

## [0.1.0-rc.3] - 2026-10-24

The third release candidate. Odudu is not production ready: it has had no security review.

### Changed

- Dependencies are updated across the server, the console, the examples and the base images, including nginx and tsup.
- Dependabot opens grouped pull requests and leaves Node major versions to a manual yearly move.

### Fixed

- A flaky registration test and two lint findings that newer tooling raised.

## [0.1.0-rc.2] - 2026-10-23

The second release candidate. Odudu is not production ready: it has had no security review.

### Added

- The documentation site is published on GitHub Pages, at https://wizzywit.github.io/odudu/.
- The contributor license agreement is approved and checked on pull requests. Contributors outside the allowlist sign by comment.

### Changed

- The README and the pages say release candidate where they said not ready.
- The quick start downloads the compose file of this candidate.
- Dependencies are updated: fastify, drizzle-orm, jose, prettier, libphonenumber-js and react-query, and vite in the example.
- CI retries the browser install, and updates the GitHub Actions cache.

### Security

- Dependency updates bring in the upstream fixes of the packages above.

## [0.1.0-rc.1] - 2026-10-23

The first release candidate. Odudu is not production ready: it has had no security review.

### Added

- A container image on `ghcr.io/wizzywit/odudu`, for amd64 and arm64, signed, with a list of its contents and a record of how it was built.
- A quick start in one command: `docker compose up -d` starts Postgres and Odudu, makes the database roles and the first administrator, and prints a one-time password.
- The `odudu` command in the image: `odudu init`, `odudu help` and `odudu --version`.
- The documentation, served by the server at `/docs/` and published as a site: a quick start, guides, concepts, a tour of the console, operating and reference pages.
- Four small example apps that sign in with Odudu: a web app, a single-page app, an API and a machine-to-machine client.
- A sign-up button: an app sends `prompt=create` to open the registration page, and discovery lists `prompt_values_supported`.
- A hand-tested guide to signing in to WordPress.
- Sign-in pages, error pages and mail in one shared look, with their text in message catalogues.
- A language chosen for each page from `ui_locales` and the browser's `Accept-Language`.
- Sign-in with the authorization code flow and PKCE, refresh tokens, client credentials, token exchange and single sign-on.
- Many tenants on one server, each with its own people, clients, keys and settings.
- Passwords, passkeys, authenticator codes and recovery codes.
- An admin API and an admin console, and an audit trail of every change and sign-in.

### Changed

- Password rules follow NIST SP 800-63B-4.
- One setting now decides the lifetime and shape of every cookie the server sets.
- Built-in scopes can be deleted, by typing their name, and restored.
- The issuer in tokens, discovery and logout is the configured `ODUDU_PUBLIC_BASE_URL`, never a request's `Host` header.
- A password reset ends every session and token the person had.

### Security

- Base images are pinned by digest, and a test keeps them so.
- Registering with an address that is already taken no longer says that it is taken, when email verification is on.
- Cookies are `Secure` and `__Host-` prefixed under `ODUDU_TLS`, from one setting; before, the session cookie ignored it.
- Characters that change the direction of text are refused in names and usernames.

[Unreleased]: https://github.com/wizzywit/odudu/compare/v0.1.0-rc.6...HEAD
[0.1.0-rc.6]: https://github.com/wizzywit/odudu/compare/v0.1.0-rc.5...v0.1.0-rc.6
[0.1.0-rc.5]: https://github.com/wizzywit/odudu/compare/v0.1.0-rc.4...v0.1.0-rc.5
[0.1.0-rc.4]: https://github.com/wizzywit/odudu/compare/v0.1.0-rc.3...v0.1.0-rc.4
[0.1.0-rc.3]: https://github.com/wizzywit/odudu/compare/v0.1.0-rc.2...v0.1.0-rc.3
[0.1.0-rc.2]: https://github.com/wizzywit/odudu/compare/v0.1.0-rc.1...v0.1.0-rc.2
[0.1.0-rc.1]: https://github.com/wizzywit/odudu/releases/tag/v0.1.0-rc.1
