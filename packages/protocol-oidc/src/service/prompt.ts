// OIDC Core §3.1.2.1's `prompt`: a space-delimited, case-sensitive list of
// ASCII values naming whether the authorization server may interact with the
// End-User at all.
export type PromptValue = 'none' | 'login' | 'consent' | 'select_account';

const DEFINED = new Set<string>(['none', 'login', 'consent', 'select_account']);

function isPromptValue(token: string): token is PromptValue {
  return DEFINED.has(token);
}

export type PromptParse =
  | { kind: 'ok'; values: ReadonlySet<PromptValue> }
  // `none` combined with anything else, or a value this server does not
  // define. §3.1.2.1 requires the first and permits the second.
  | { kind: 'invalid' };

// Absent, empty, and all-whitespace all parse to no values: an empty
// parameter value is an omitted one (RFC 6749 §3.1), and a list of no values
// asks for nothing.
export function parsePrompt(raw: string | undefined): PromptParse {
  if (raw === undefined) return { kind: 'ok', values: new Set() };

  const values = new Set<PromptValue>();
  for (const token of raw.split(' ')) {
    if (token.length === 0) continue;
    if (!isPromptValue(token)) return { kind: 'invalid' };
    values.add(token);
  }

  // "If this parameter contains none with any other value, an error is
  // returned" — the two demands contradict each other, and a server that
  // picked one of them would be guessing which one the client meant.
  if (values.has('none') && values.size > 1) return { kind: 'invalid' };

  return { kind: 'ok', values };
}
