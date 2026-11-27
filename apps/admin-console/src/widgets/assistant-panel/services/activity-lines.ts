// What a tool call has come to, as the log draws it. A test holds every tool the
// assistant can call to a phrase for each state, so this file reads no alias.
export type StepState = 'running' | 'waiting' | 'done' | 'failed' | 'denied';

export interface ToolCallView {
  name: string;
  state: StepState;
  // How long the step took, once this panel has watched it finish.
  durationMs?: number | null;
}

export interface ActivityLine {
  text: string;
  state: StepState;
  durationMs: number | null;
}

interface Phrase {
  doing: string;
  done: string;
}

// Plain-language phrases for the tools whose name does not say it well. A tool
// with no entry here is worded from its name (`list_`, `get_`, `count_`), and a
// name that follows no pattern is worded generically.
const PHRASES: Readonly<Record<string, Phrase>> = {
  whoami: { doing: 'Checking who you are', done: 'Checked who you are' },
  get_subject_lockout: { doing: 'Checking lockout state', done: 'Checked lockout state' },
  get_subject_required_actions: {
    doing: 'Checking required actions',
    done: 'Checked required actions',
  },
  get_subject_admin_capabilities: {
    doing: 'Checking administrator capabilities',
    done: 'Checked administrator capabilities',
  },
  list_subject_effective_roles: {
    doing: 'Listing the roles a subject holds',
    done: 'Listed the roles a subject holds',
  },
  list_audit: { doing: 'Reading the audit trail', done: 'Read the audit trail' },
  count_audit: { doing: 'Counting audit events', done: 'Counted audit events' },
  get_passkey_impact: { doing: 'Checking passkey impact', done: 'Checked passkey impact' },
  get_scope_impact: {
    doing: 'Checking where a scope is used',
    done: 'Checked where a scope is used',
  },
  update_client_metadata: { doing: 'Proposing a client change', done: 'Changed a client' },
  update_scope_metadata: { doing: 'Proposing a scope change', done: 'Changed a scope' },
  update_role_description: { doing: 'Proposing a role change', done: 'Changed a role' },
  update_group_description: { doing: 'Proposing a group change', done: 'Changed a group' },
  create_role: { doing: 'Proposing a new role', done: 'Created a role' },
  create_group: { doing: 'Proposing a new group', done: 'Created a group' },
  create_scope: { doing: 'Proposing a new scope', done: 'Created a scope' },
  update_tenant_text_settings: {
    doing: 'Proposing a change to the tenant’s text settings',
    done: 'Changed the tenant’s text settings',
  },
  set_message_override: { doing: 'Proposing a message wording', done: 'Set a message wording' },
  clear_message_override: {
    doing: 'Proposing to remove a message wording',
    done: 'Removed a message wording',
  },
  update_theme_draft: { doing: 'Proposing a theme draft', done: 'Saved a theme draft' },
  update_client_theme_draft: {
    doing: 'Proposing a client theme draft',
    done: 'Saved a client theme draft',
  },
};

const VERBS: Readonly<Record<string, Phrase>> = {
  list: { doing: 'Listing', done: 'Listed' },
  get: { doing: 'Reading', done: 'Read' },
  count: { doing: 'Counting', done: 'Counted' },
};

function spaced(name: string): string {
  return name.replace(/_/gu, ' ');
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Whether the table words this tool itself; the rest are worded from the name.
export function hasPhrase(name: string): boolean {
  return PHRASES[name] !== undefined;
}

// The tools the table words, so a test can tell one that no longer exists.
export function phrasedTools(): string[] {
  return Object.keys(PHRASES);
}

function phraseOf(name: string): Phrase {
  const known = PHRASES[name];
  if (known !== undefined) return known;
  const [verb = '', ...rest] = name.split('_');
  const noun = rest.join(' ');
  const pattern = VERBS[verb];
  if (pattern !== undefined && noun !== '') {
    return { doing: `${pattern.doing} ${noun}`, done: `${pattern.done} ${noun}` };
  }
  return { doing: `Running ${spaced(name)}`, done: capital(spaced(name)) };
}

function textFor(phrase: Phrase, state: StepState): string {
  switch (state) {
    case 'running':
      return phrase.doing;
    case 'done':
      return phrase.done;
    case 'failed':
      return `${phrase.doing} failed`;
    case 'waiting':
      return `${phrase.doing}, waiting for you`;
    case 'denied':
      return `${phrase.doing}, refused`;
  }
}

// The one line a step is drawn as, from the tool's name and what has become of
// it. Never the call's own arguments, which a model chose.
export function activityLine(call: ToolCallView): ActivityLine {
  return {
    text: textFor(phraseOf(call.name), call.state),
    state: call.state,
    durationMs: call.durationMs ?? null,
  };
}

// A step's time as a short phrase: under a second says so, then seconds.
export function durationText(ms: number): string {
  if (ms < 1_000) return 'under 1 s';
  if (ms < 10_000) return `${(ms / 1_000).toFixed(1)} s`;
  return `${String(Math.round(ms / 1_000))} s`;
}
