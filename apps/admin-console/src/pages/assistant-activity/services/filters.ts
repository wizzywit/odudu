import { ASSISTANT_TOOL_NAME_PATTERN } from '@odudu/contracts/admin';

export type TextFilter = 'person' | 'conversation' | 'tool';

export const TEXT_FILTERS: readonly TextFilter[] = ['person', 'conversation', 'tool'];

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const PROBLEMS: Readonly<Record<TextFilter, string>> = {
  person: 'A person is named by an id, like 0b6f1c2e-5a7d-4e1a-9b3c-2d8f4a6e7c10.',
  conversation: 'A conversation is named by an id, like 0b6f1c2e-5a7d-4e1a-9b3c-2d8f4a6e7c10.',
  tool: 'A tool name is lower-case words joined by underscores, like list_clients.',
};

function valid(name: TextFilter, value: string): boolean {
  return name === 'tool' ? ASSISTANT_TOOL_NAME_PATTERN.test(value) : ID.test(value);
}

export type Drafts = Readonly<Partial<Record<TextFilter, string>>>;
export type Problems = Readonly<Partial<Record<TextFilter, string>>>;

// What a field shows: what is being typed in it, else what the address applies.
export function typedValue(
  drafts: Drafts,
  applied: Readonly<Record<string, string>>,
  name: TextFilter,
): string {
  return drafts[name] ?? applied[name] ?? '';
}

export function withDraft(drafts: Drafts, name: TextFilter, typed: string): Drafts {
  return { ...drafts, [name]: typed };
}

// A draft that was applied goes; one that was not stays to be mended.
export function settledDrafts(drafts: Drafts, name: TextFilter, committed: Committed): Drafts {
  if (committed.problem !== undefined) return drafts;
  return Object.fromEntries(Object.entries(drafts).filter(([held]) => held !== name));
}

export function withProblem(
  problems: Problems,
  name: TextFilter,
  problem: string | undefined,
): Problems {
  const rest = Object.fromEntries(Object.entries(problems).filter(([held]) => held !== name));
  return problem === undefined ? rest : { ...rest, [name]: problem };
}

export interface Committed {
  // What the filter is set to: the text, or none where it was cleared.
  value: string | null;
  // Why it was not applied, or nothing.
  problem: string | undefined;
}

// A typed filter is applied once it is whole: an empty one clears it and a
// malformed one is explained rather than sent to be refused.
export function commitFilter(name: TextFilter, typed: string): Committed {
  const text = typed.trim();
  if (text === '') return { value: null, problem: undefined };
  return valid(name, text)
    ? { value: text, problem: undefined }
    : { value: null, problem: PROBLEMS[name] };
}

// A value that was applied as typed, for a draft that is to be dropped.
export const APPLIED: Committed = { value: null, problem: undefined };
