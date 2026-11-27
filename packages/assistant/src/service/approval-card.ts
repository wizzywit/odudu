import {
  CARD_FIELD_MAX,
  SET_DIFF_MAX,
  SET_DIFF_NAME_MAX,
  type AssistantSetDiff,
  type AssistantTier,
} from '@odudu/contracts/admin';
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

// What kind of record a call names, for the facts the tier is decided on.
export type TargetKind = 'role' | 'group' | 'subject' | 'client' | 'session' | 'other';

type Names = readonly string[];

// A tier C change is only decided by typing a text the server writes: the name
// of what it changes, whole.
// A change above tier A names the kind of record it touches, so that leaving it
// out is a type error and never a target nobody judged.
type Tiering =
  | { readonly tier: 'A'; readonly kind?: TargetKind }
  | { readonly tier: 'B'; readonly kind: TargetKind }
  | {
      readonly tier: 'C';
      readonly kind: TargetKind;
      readonly confirmWith: (input: Input, before: CardFields | null) => string;
    };

// A role or group a body grants, beside the record it names.
export interface GrantedRef {
  readonly kind: 'role' | 'group';
  readonly id: string;
}

type Plan = Tiering & {
  // One line saying what the change does; a constant, never the model's words.
  readonly title: string;
  readonly target: string;
  // The roles and groups the body grants, whose reach counts as the target's.
  readonly grants?: (input: Input) => readonly GrantedRef[];
  // The call replaces state the card read, with no precondition the write
  // carries from the card: the read is made again when the approval is spent.
  readonly replaces?: true;
  // The names the call leaves in a list it replaces and the names there are now.
  readonly diff?: (input: Input, data: unknown) => { before: Names; after: Names } | undefined;
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
};

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
    tier: 'A',
    kind: 'client',
    title: 'Change the name or description of a client',
    target: 'client',
    idFrom: idOf,
    read: byId('get_client'),
  },
  update_scope_metadata: {
    tier: 'A',
    title: 'Change the description of a scope',
    target: 'scope',
    idFrom: idOf,
    read: byId('get_scope'),
  },
  update_role_description: {
    tier: 'A',
    kind: 'role',
    title: 'Change the description of a role',
    target: 'role',
    idFrom: idOf,
    read: byId('get_role'),
  },
  update_group_description: {
    tier: 'A',
    kind: 'group',
    title: 'Change the description of a group',
    target: 'group',
    idFrom: idOf,
    read: byId('get_group'),
  },
  create_role: { tier: 'A', title: 'Create a role that grants nothing', target: 'role' },
  create_group: { tier: 'A', title: 'Create a group', target: 'group' },
  create_scope: { tier: 'A', title: 'Create a scope', target: 'scope' },
  update_tenant_text_settings: {
    tier: 'A',
    title: 'Change the display name or the languages of the tenant',
    target: 'tenant settings',
    read: { tool: 'get_settings', args: () => ({}) },
  },
  set_message_override: {
    tier: 'A',
    replaces: true,
    title: 'Set the wording of one message in one language',
    target: 'message',
    idFrom: (input) => `${String(input.locale)} ${String(input.key)}`,
    read: overrides,
    pages: true,
    mayCreate: true,
    pick: (page, _names, input) => overrideIn(page, input),
  },
  clear_message_override: {
    tier: 'B',
    kind: 'other',
    title: 'Remove the wording of one message in one language',
    target: 'message',
    idFrom: (input) => `${String(input.locale)} ${String(input.key)}`,
    read: overrides,
    pages: true,
    removes: true,
    pick: (page, _names, input) => overrideIn(page, input),
  },
  update_theme_draft: {
    tier: 'A',
    replaces: true,
    title: 'Save a draft of the tenant’s theme',
    target: 'theme draft',
    read: { tool: 'get_theme', args: () => ({}) },
    pick: (view, names) => Object.fromEntries(names.map((name) => [name, themePart(view, name)])),
  },
  update_client_theme_draft: {
    tier: 'A',
    replaces: true,
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

/** What the tool asks of the person before its tier rises by target. */
export function tierOfTool(tool: string): AssistantTier {
  return planOf(tool).tier;
}

/** What kind of record the tool's call names; a tier A tool that says nothing names none. */
export function targetKindOf(tool: string): TargetKind {
  return planOf(tool).kind ?? 'other';
}

/** The roles and groups the call's body grants. */
export function grantsOf(tool: string, input: unknown): readonly GrantedRef[] {
  return planOf(tool).grants?.(asRecord(input) ?? {}) ?? [];
}

/** Whether the tool removes what it names. */
export function removesTarget(tool: string): boolean {
  return planOf(tool).removes === true;
}

/** The text a tier C decision must carry, or null for a tool of a lower tier. */
export function confirmTextOf(
  tool: string,
  input: unknown,
  before: CardFields | null,
): string | null {
  const plan = planOf(tool);
  return plan.tier === 'C' ? plan.confirmWith(asRecord(input) ?? {}, before) : null;
}

/** Whether the tool replaces state the card read and so reads it again when the approval is spent. */
export function replacesState(tool: string): boolean {
  return planOf(tool).replaces === true;
}

/**
 * Whether the target no longer reads as the card showed it. The comparison is
 * over the fields the call names, as the card carries them, so a field the call
 * does not touch cannot close an approval.
 */
export function stateMoved(
  tool: string,
  names: readonly string[],
  input: unknown,
  stored: CardFields | null,
  data: unknown,
): boolean {
  const now = beforeOf(tool, names, input, data);
  return JSON.stringify(now ?? null) !== JSON.stringify(stored);
}

/** Whether the set change the call would make now differs from the one the card showed. */
export function diffMoved(
  tool: string,
  input: unknown,
  stored: AssistantSetDiff | undefined,
  data: unknown,
): boolean {
  const now = diffOf(tool, input, data);
  return JSON.stringify(now ?? null) !== JSON.stringify(stored ?? null);
}

/**
 * What a call that replaces a list adds and removes, names sorted, or
 * `oversize` when either side or a name does not fit a card whole; undefined
 * for a tool that replaces no list.
 */
export function diffOf(
  tool: string,
  input: unknown,
  data: unknown,
): AssistantSetDiff | 'oversize' | undefined {
  const sides = planOf(tool).diff?.(asRecord(input) ?? {}, data);
  return sides === undefined ? undefined : setDiff(sides.before, sides.after);
}

/** The names `after` has and `before` lacks, and the reverse, or `oversize`. */
export function setDiff(
  before: readonly string[],
  after: readonly string[],
): AssistantSetDiff | 'oversize' {
  const had = new Set(before);
  const has = new Set(after);
  const added = [...has].filter((name) => !had.has(name)).sort();
  const removed = [...had].filter((name) => !has.has(name)).sort();
  const fits = (names: readonly string[]): boolean =>
    names.length <= SET_DIFF_MAX && names.every((name) => name.length <= SET_DIFF_NAME_MAX);
  return fits(added) && fits(removed) ? { kind: 'set', added, removed } : 'oversize';
}
