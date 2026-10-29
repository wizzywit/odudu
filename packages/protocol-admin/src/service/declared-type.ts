const SHOWN_MAX = 60;

// The media type a request declares, without parameters and lowercased
// (`IMAGE/PNG; x=y` is `image/png`); undefined when no type is declared.
export function declaredEssence(header: string | undefined): string | undefined {
  const essence = header?.split(';')[0]?.trim().toLowerCase();
  return essence === undefined || essence === '' ? undefined : essence;
}

// What a refusal may say of a declared type: only the characters a media
// type's token allows, so a hostile header cannot put markup, quotes or
// control characters in a problem body, and no more than SHOWN_MAX of them.
export function shownType(essence: string): string {
  const safe = essence.replace(/[^a-z0-9!#$%&'*+.^_`|~/-]/gu, '?');
  return safe.length > SHOWN_MAX ? `${safe.slice(0, SHOWN_MAX)}…` : safe;
}

function oneOf(names: readonly string[]): string {
  const last = names.at(-1) ?? '';
  return names.length < 2 ? last : `${names.slice(0, -1).join(', ')} or ${last}`;
}

// The detail of a 415 for a declared type: the one declared, and what is
// accepted. Different in kind from the refusal for bytes, which names no type.
export function declaredTypeDetail(
  essence: string | undefined,
  accepted: readonly string[],
): string {
  const said =
    essence === undefined ? 'no type was declared' : `the declared type is ${shownType(essence)}`;
  return `${said}, not ${oneOf(accepted)}`;
}
