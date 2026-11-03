# branding-editor

The theme, pages and publication editors that the Branding area and a
client's Branding tab both draw: colours and font, images, stylesheet, page
templates, the preview beside them and the bar that publishes, reverts and
discards.

## What it composes

- `entities/session` for what the caller may write and `entities/tenant` for
  the tenant's settings. No other entity, no widget and no page.

## Rules owned

- One spelling set for the colour scheme: "Light", "Light colours", "light
  colours" and the "Colour scheme" picker label all come from
  `services/colourScheme.ts`.
- A client's theme is its client's to change: writes under a client scope need
  `manage-clients` and are keyed and tagged by that client, the tenant's under
  `manage-tenant`.
- The saved draft is what publishes: publishing is held while any section has
  unsaved edits, and the hold names those sections.
- The stylesheet and the page templates are bounded by the server's byte
  limits, mirrored in `services` and held to the server's own by
  `tests/lint/console-branding-mirrors.test.ts`.

## Exports

The two scope panels, the publication bar, the preview shell, the message-key
field and `Workspace`, the hooks that read and edit a scope's theme, and the
scope, tab and scheme names the Branding page and `pages/clients` need.
Adapters and repositories are never exported.

`SCHEME_PREVIEW_WORDS` carries functions (the scheme's name, its title and the
strip's join) so the mail preview on `pages/branding` speaks of the scheme in
the editor's own words without importing a service.

`pages/branding` holds the mail, languages and message-override tabs and
composes this feature through its index.
