// What a reader who may see the metadata of a conversation but not its text is
// given in place of the text: the kinds, the tool names, the timings and the
// sizes of what was withheld, and a stated placeholder where the words were.
// An event kind passes whole only if it is named here as one the server builds
// from names and counts; every other kind, and any added later, is withheld.
import type { AssistantActivityReplay } from '@odudu/contracts/admin';

type Event = AssistantActivityReplay['turns'][number]['events'][number];
type Kind = Event['kind'];

export const TEXT_WITHHELD = '[text not visible to auditors in this tenant]';

/** Kinds the turn's own code writes as names and counts, with no words of a person or a model. */
export const METADATA_KINDS: readonly Kind[] = [
  'model_call',
  'slot_chosen',
  'reservation',
  'narrowing',
  'policy',
  'trimming',
  'truncated',
];

/** Kinds that carry words and are cut down to what names or times them. */
export const TEXT_KINDS: readonly Kind[] = [
  'text',
  'tool_call',
  'tool_result',
  'tool_error',
  'error',
];

function sizeOf(value: unknown): number {
  return Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value ?? null));
}

function pick(payload: Record<string, unknown>, names: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(names.filter((name) => name in payload).map((n) => [n, payload[n]]));
}

function words(event: Event, keep: readonly string[], member: string, said: unknown): Event {
  return {
    ...event,
    payload: { ...pick(event.payload, keep), [member]: TEXT_WITHHELD, bytes: sizeOf(said) },
  };
}

/** The event with its words replaced, keeping what names a tool or times the call. */
export function withholdEvent(event: Event): Event {
  const { payload } = event;
  switch (event.kind) {
    case 'text':
      return words(event, [], 'text', payload.text);
    case 'tool_call':
      return words(event, ['tool', 'tool_call_id'], 'input', payload.input);
    case 'tool_result':
      return words(event, ['tool', 'tool_call_id', 'ms'], 'output', payload.output);
    case 'tool_error':
      return words(event, ['tool', 'tool_call_id', 'ms'], 'error', payload.error);
    case 'error':
      return words(event, ['name', 'aborted'], 'message', payload.message);
    default:
      return METADATA_KINDS.includes(event.kind)
        ? event
        : { ...event, payload: { withheld: TEXT_WITHHELD, bytes: sizeOf(payload) } };
  }
}
