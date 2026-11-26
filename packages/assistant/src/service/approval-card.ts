import { CARD_FIELD_MAX } from '@odudu/contracts/admin';
import type { RegisteredTool } from '@odudu/mcp';

type Scalar = string | number | boolean | null;
export type CardFields = Record<string, Scalar>;
type Input = Record<string, unknown>;

export interface CardTarget {
  readonly type: string;
  readonly id?: string;
  readonly name?: string;
}

export interface ReadStep {
  readonly tool: string;
  readonly args: Input;
}

interface Plan {
  // One line saying what the change does; a constant, never the model's words.
  readonly title: string;
  readonly target: string;
  // Which input member names the target, where there is one.
  readonly idFrom?: (input: Input) => string | undefined;
  // How the target is read before it changes. A create reads nothing.
  readonly read?: { readonly tool: string; readonly args: (input: Input) => Input };
  // A read that answers a page: where the next page starts.
  readonly pages?: true;
  // What the removal sets: nothing.
  readonly removes?: true;
  // A target that is not there yet is no reason to refuse: the call makes it.
  readonly mayCreate?: true;
  // The fields of the read that the call's fields are compared with.
  readonly pick?: (data: unknown, names: readonly string[], input: Input) => unknown;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const idOf = (input: Input): string | undefined =>
  typeof input.id === 'string' ? input.id : undefined;

const byId = (tool: string) => ({
  tool,
  args: (input: Input): Input => ({ id: input.id }),
});

// A theme's parts, from the draft when there is one and otherwise the
// published theme the draft would start from.
function themePart(view: unknown, part: string): unknown {
  const record = asRecord(view);
  const draft = asRecord(record?.draft);
  if (draft !== undefined && Object.hasOwn(draft, part)) return draft[part];
  return asRecord(asRecord(record?.published)?.body)?.[part] ?? null;
}

// The override for the locale and key the call names, out of one page.
function overrideIn(page: unknown, input: Input): unknown {
  if (!Array.isArray(page)) return undefined;
  return (
    page.find((row) => {
      const entry = asRecord(row);
      return entry !== undefined && entry.key === input.key && entry.locale === input.locale;
    }) ?? null
  );
}

const OVERRIDE_PAGE = 200;
const overrides = {
  tool: 'list_message_overrides',
  args: (input: Input): Input => ({ locale: input.locale, limit: OVERRIDE_PAGE }),
};

export const WRITE_PLANS: Readonly<Record<string, Plan>> = {
  update_client_metadata: {
    title: 'Change the name or description of a client',
    target: 'client',
    idFrom: idOf,
    read: byId('get_client'),
  },
  update_scope_metadata: {
    title: 'Change the description of a scope',
    target: 'scope',
    idFrom: idOf,
    read: byId('get_scope'),
  },
  update_role_description: {
    title: 'Change the description of a role',
    target: 'role',
    idFrom: idOf,
    read: byId('get_role'),
  },
  update_group_description: {
    title: 'Change the description of a group',
    target: 'group',
    idFrom: idOf,
    read: byId('get_group'),
  },
  create_role: { title: 'Create a role that grants nothing', target: 'role' },
  create_group: { title: 'Create a group', target: 'group' },
  create_scope: { title: 'Create a scope', target: 'scope' },
  update_tenant_text_settings: {
    title: 'Change the display name or the languages of the tenant',
    target: 'tenant settings',
    read: { tool: 'get_settings', args: () => ({}) },
  },
  set_message_override: {
    title: 'Set the wording of one message in one language',
    target: 'message',
    idFrom: (input) => `${String(input.locale)} ${String(input.key)}`,
    read: overrides,
    pages: true,
    mayCreate: true,
    pick: (page, _names, input) => overrideIn(page, input),
  },
  clear_message_override: {
    title: 'Remove the wording of one message in one language',
    target: 'message',
    idFrom: (input) => `${String(input.locale)} ${String(input.key)}`,
    read: overrides,
    pages: true,
    removes: true,
    pick: (page, _names, input) => overrideIn(page, input),
  },
  update_theme_draft: {
    title: 'Save a draft of the tenant’s theme',
    target: 'theme draft',
    read: { tool: 'get_theme', args: () => ({}) },
    pick: (view, names) => Object.fromEntries(names.map((name) => [name, themePart(view, name)])),
  },
  update_client_theme_draft: {
    title: 'Save a draft of a client’s theme',
    target: 'client theme draft',
    idFrom: idOf,
    read: byId('get_client_theme'),
    pick: (view, names) => Object.fromEntries(names.map((name) => [name, themePart(view, name)])),
  },
};

const NAMES: ReadonlySet<string> = new Set(Object.keys(WRITE_PLANS));

/** The names of the twelve writes the assistant may propose. */
export function writeToolNames(): ReadonlySet<string> {
  return NAMES;
}

function planOf(tool: string): Plan {
  const plan = WRITE_PLANS[tool];
  if (plan === undefined) throw new Error(`${tool} is not a change the assistant may propose`);
  return plan;
}

export function titleOf(tool: string): string {
  return planOf(tool).title;
}

// The text a card shows for a value: the value itself, or the JSON it is.
function valueText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

// A value a card can show, whole: a plain scalar, or text. A value too long for
// the card is refused before a card is made (`oversizeField`), never cut here.
function scalar(value: unknown): Scalar {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return valueText(value);
}

/**
 * The first field of the call whose value is longer than a card holds, or
 * undefined. A card that showed a prefix would hide the rest of what the person
 * approves, so such a call is not proposed.
 */
export function oversizeField(names: readonly string[], input: unknown): string | undefined {
  const record = asRecord(input) ?? {};
  return names.find((name) => valueText(record[name]).length > CARD_FIELD_MAX);
}

/** The first member of what the server read that is longer than a card holds. */
export function oversizeBefore(before: CardFields | null): string | undefined {
  if (before === null) return undefined;
  return Object.keys(before).find((name) => valueText(before[name]).length > CARD_FIELD_MAX);
}

/** The body fields a call names, in the tool's own order. */
export function changedFields(tool: Pick<RegisteredTool, 'bodyFields'>, input: unknown): string[] {
  const record = asRecord(input) ?? {};
  return (tool.bodyFields ?? []).filter((field) => record[field] !== undefined);
}

/** What the call would set, from the stored call; null for a removal. */
export function afterOf(tool: string, names: readonly string[], input: unknown): CardFields | null {
  if (planOf(tool).removes === true) return null;
  const record = asRecord(input) ?? {};
  return Object.fromEntries(names.map((name) => [name, scalar(record[name])]));
}

/**
 * The target as it stands, for the fields the call names: null for a target
 * that does not exist (a create reads nothing), undefined where the read's
 * answer is not the shape the plan expects, which refuses the proposal.
 */
export function beforeOf(
  tool: string,
  names: readonly string[],
  input: unknown,
  data: unknown,
): CardFields | null | undefined {
  const plan = planOf(tool);
  if (plan.read === undefined) return null;
  const args = asRecord(input) ?? {};
  const source = plan.pick === undefined ? data : plan.pick(data, names, args);
  if (source === null) return null;
  const record = asRecord(source);
  if (record === undefined) return undefined;
  if (plan.removes === true && plan.pick !== undefined) {
    return Object.fromEntries(['message'].map((name) => [name, scalar(record[name])]));
  }
  return Object.fromEntries(names.map((name) => [name, scalar(record[name])]));
}

/** What the card says it changes, with the name the read returned. */
export function targetOf(tool: string, input: unknown, data: unknown): CardTarget {
  const plan = planOf(tool);
  const record = asRecord(input) ?? {};
  const id = plan.idFrom?.(record);
  const name = asRecord(data)?.name;
  return {
    type: plan.target,
    ...(id === undefined ? {} : { id }),
    ...(typeof name === 'string' ? { name } : {}),
  };
}

/** Whether the target may be missing when the call is made, because the call creates it. */
export function mayCreate(tool: string): boolean {
  return planOf(tool).mayCreate === true;
}

/** The read that shows the target before the change, or undefined for a create. */
export function readStepOf(tool: string, input: unknown): ReadStep | undefined {
  const plan = planOf(tool);
  if (plan.read === undefined) return undefined;
  return { tool: plan.read.tool, args: plan.read.args(asRecord(input) ?? {}) };
}

/** Where the read's next page starts, for a plan whose read is a page. */
export function cursorOf(tool: string, answer: unknown): string | undefined {
  if (planOf(tool).pages !== true) return undefined;
  const next = asRecord(answer)?.next_cursor;
  return typeof next === 'string' ? next : undefined;
}
