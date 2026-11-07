import type { ThemeBodyWire } from '@odudu/contracts';
import { themeViewSchema } from '@odudu/contracts/admin';
import { isEtag } from '#/service/etag-shape';
import { jsonObjectOf } from '#/service/json-value';
import { ToolProblem, type JsonObject } from '#/service/tool';

// What a tool may send as a theme draft, in bytes of its JSON: under the
// admin API's own 4 MiB, and under what a call may read back.
export const THEME_WRITE_CAP_BYTES = 512 * 1024;

// The draft as the admin API stored it, which is what a part the caller did
// not name is written back as. Nothing here cleans, cuts or normalises text: a
// stylesheet read for the model is not this one, and the two never meet.
export interface HeldTheme {
  // The draft's etag, or null where there is no draft.
  readonly etag: string | null;
  readonly base: ThemeBodyWire;
}

export interface NamedParts {
  readonly tokens?: ThemeBodyWire['tokens'] | undefined;
  readonly stylesheet?: ThemeBodyWire['stylesheet'] | undefined;
  readonly templates?: ThemeBodyWire['templates'] | undefined;
}

const EMPTY: ThemeBodyWire = { tokens: {}, stylesheet: null, templates: {}, assets: {} };

function unreadable(): ToolProblem {
  return new ToolProblem(
    'mcp:unexpected_response',
    'The admin API answered a theme without a usable etag for its draft',
    null,
  );
}

// The draft, or the scope's own published theme when it has none, and the etag
// of the draft the write will have to name. The body is the raw answer.
export function heldOf(answer: unknown, etag: string | undefined): HeldTheme {
  const view = themeViewSchema.parse(answer);
  if (view.draft === null) return { etag: null, base: view.published?.body ?? EMPTY };
  if (!isEtag(etag)) throw unreadable();
  return { etag, base: view.draft };
}

// The body of the write: each part the caller named as they sent it, every
// other part as the draft holds it, images included.
export function mergedBody(base: ThemeBodyWire, named: NamedParts): JsonObject {
  const merged: ThemeBodyWire = {
    tokens: named.tokens ?? base.tokens,
    stylesheet: named.stylesheet === undefined ? base.stylesheet : named.stylesheet,
    templates: named.templates ?? base.templates,
    assets: base.assets,
  };
  const body = jsonObjectOf(merged);
  if (Buffer.byteLength(JSON.stringify(body)) > THEME_WRITE_CAP_BYTES) {
    throw new ToolProblem(
      'mcp:invalid_arguments',
      'The draft would be larger than this tool writes',
      400,
      'The whole draft, with the parts left as they are, would pass 512 KiB. Shorten a part, or ' +
        'edit this draft in the console.',
    );
  }
  return body;
}
