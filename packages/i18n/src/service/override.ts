import { IntlMessageFormat } from 'intl-messageformat';
import { type MessageValues } from '#/service/catalogue';

export const MAX_OVERRIDE_LENGTH = 2000;

// A tenant's text is untrusted: a `<` is a character to show, never a rich-text
// tag for the message syntax to strip or choke on.
function formatterFor(message: string, tag: string): IntlMessageFormat {
  return new IntlMessageFormat(message, tag, undefined, { ignoreTag: true });
}

// What is wrong with a message a tenant wants shown in place of a catalogue
// one, or null. Markup is not wrong: it is escaped where it is shown.
export function overrideProblem(message: string): string | null {
  if (message === '') return 'must not be empty';
  if (message.length > MAX_OVERRIDE_LENGTH) {
    return `must be at most ${String(MAX_OVERRIDE_LENGTH)} characters`;
  }
  // The two private-use characters translators.ts marks isolated slots with.
  if (/[\uE000\uE001]/u.test(message)) return 'contains a character reserved for the server';
  try {
    formatterFor(message, 'en');
  } catch {
    return 'is not a valid message: check its braces and plural arms';
  }
  return null;
}

type Element = ReturnType<IntlMessageFormat['getAst']>[number];

const LITERAL = 0;
const POUND = 7;

// Every argument a message reads, wherever it sits: bare, as the subject of a
// plural or select, or inside an arm.
function argumentNames(elements: readonly Element[], into: Set<string>): Set<string> {
  for (const element of elements) {
    // The element kinds are an enum of the parser package, which is not a dependency here.
    const kind: number = element.type;
    if (kind === LITERAL || kind === POUND) continue;
    if ('value' in element) into.add(element.value);
    if ('options' in element) {
      for (const arm of Object.values(element.options)) argumentNames(arm.value, into);
    }
    if ('children' in element) argumentNames(element.children, into);
  }
  return into;
}

const NAMES_SHOWN = 5;
const NAME_LENGTH = 40;

function braced(names: readonly string[]): string {
  const shown = names.slice(0, NAMES_SHOWN).map((name) => `{${name.slice(0, NAME_LENGTH)}}`);
  return names.length > NAMES_SHOWN ? `${shown.join(', ')} and more` : shown.join(', ');
}

// What is wrong with an override reading an argument the page it replaces
// does not supply: the page would show the catalogue's text instead, with
// nothing to say why. Null for what does not parse, which `overrideProblem`
// refuses on its own.
export function placeholderProblem(message: string, original: string): string | null {
  let wanted: Set<string>;
  let supplied: Set<string>;
  try {
    wanted = argumentNames(formatterFor(message, 'en').getAst(), new Set());
    supplied = argumentNames(formatterFor(original, 'en').getAst(), new Set());
  } catch {
    return null;
  }
  const unknown = [...wanted].filter((name) => !supplied.has(name));
  if (unknown.length === 0) return null;
  const given = supplied.size === 0 ? 'supplies no value' : `supplies ${braced([...supplied])}`;
  return `uses ${braced(unknown)}, which the page does not supply; the page ${given}`;
}

// The arguments an override of a key must read, because what they carry is
// something the page owes the person: the consent heading names the
// application asking, which OIDC Core 3.1.2.4 expects a person to be told.
const REQUIRED_ARGUMENTS: Readonly<Record<string, readonly string[]>> = {
  'consent.heading': ['client'],
};

const REQUIRED_REASONS: Readonly<Record<string, string>> = {
  client: 'names the application asking for access',
};

// What is wrong with an override that leaves out an argument its key requires,
// or null. Null for what does not parse, which `overrideProblem` refuses.
export function requiredArgumentsProblem(key: string, message: string): string | null {
  const required = Object.hasOwn(REQUIRED_ARGUMENTS, key) ? REQUIRED_ARGUMENTS[key] : undefined;
  if (required === undefined) return null;
  let wanted: Set<string>;
  try {
    wanted = argumentNames(formatterFor(message, 'en').getAst(), new Set());
  } catch {
    return null;
  }
  const missing = required.filter((name) => !wanted.has(name));
  if (missing.length === 0) return null;
  const [first] = missing;
  return `must use ${braced(missing)}, which ${REQUIRED_REASONS[first ?? ''] ?? 'the page needs'}`;
}

// One parsed message per (map, key): the map is the cached per-tenant,
// per-locale one, so the parse is paid once while it lives.
const parsed = new WeakMap<object, Map<string, IntlMessageFormat | null>>();

// The override formatted, or null when it cannot be: a placeholder the page
// does not supply, or syntax a stored message should never have had.
export function formatOverride(
  overrides: Readonly<Record<string, string>>,
  tag: string,
  id: string,
  values: MessageValues | undefined,
): string | null {
  if (!Object.hasOwn(overrides, id)) return null;
  let byKey = parsed.get(overrides);
  if (byKey === undefined) {
    byKey = new Map();
    parsed.set(overrides, byKey);
  }
  let formatter = byKey.get(id);
  if (formatter === undefined) {
    try {
      formatter = formatterFor(overrides[id] ?? '', tag);
    } catch {
      formatter = null;
    }
    byKey.set(id, formatter);
  }
  if (formatter === null) return null;
  try {
    const out = formatter.format(values);
    return typeof out === 'string' ? out : [out].flat().join('');
  } catch {
    return null;
  }
}
