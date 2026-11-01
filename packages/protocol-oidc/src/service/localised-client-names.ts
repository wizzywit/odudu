import {
  canonicalLocale,
  checkLocalisedText,
  LOCALISED_TEXT_ENTRIES_MAX,
  type LocalisedText,
} from '@odudu/contracts';
import { CLIENT_NAME_MAX } from '@odudu/contracts/admin';

const PREFIX = 'client_name#';

export type LocalisedClientNames =
  { kind: 'ok'; names: LocalisedText } | { kind: 'invalid'; description: string };

function invalid(description: string): LocalisedClientNames {
  return { kind: 'invalid', description };
}

/**
 * The `client_name#<tag>` members of a registration body (RFC 7591 §2.2), as
 * text by canonical tag. A well-formed tag the tenant does not offer is left
 * out, which §2.2 permits; a malformed one, a repeat, a bad value or more
 * than 32 members is refused. A refusal never repeats the member's name.
 */
export function parseLocalisedClientNames(
  body: Readonly<Record<string, unknown>>,
  supported: readonly string[],
): LocalisedClientNames {
  const members = Object.keys(body).filter((key) => key.startsWith(PREFIX));
  if (members.length > LOCALISED_TEXT_ENTRIES_MAX) {
    return invalid(`at most ${String(LOCALISED_TEXT_ENTRIES_MAX)} client_name#<language> members`);
  }
  const offered = new Set(supported.map((tag) => canonicalLocale(tag) ?? tag));
  const names: Record<string, unknown> = {};
  const seen = new Set<string>();
  for (const member of members) {
    const tag = canonicalLocale(member.slice(PREFIX.length));
    if (tag === null) {
      return invalid('a client_name#<language> member does not name a language tag');
    }
    if (seen.has(tag)) {
      return invalid('client_name#<language> names one language more than once');
    }
    seen.add(tag);
    if (offered.has(tag)) names[tag] = body[member];
  }
  const checked = checkLocalisedText('client_name#<language>', names, { max: CLIENT_NAME_MAX });
  return checked.kind === 'ok' ? { kind: 'ok', names: checked.value } : invalid(checked.message);
}
