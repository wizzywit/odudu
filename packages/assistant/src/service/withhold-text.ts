// What a reader who may see the metadata of a conversation but not its text is
// given in place of the text: the kinds, the tool names, the timings and the
// sizes of what was withheld, and a stated placeholder where the words were.
import type { AssistantActivityReplay } from '@odudu/contracts/admin';

type Event = AssistantActivityReplay['turns'][number]['events'][number];

export const TEXT_WITHHELD = '[text not visible to auditors in this tenant]';

function sizeOf(value: unknown): number {
  return Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value ?? null));
}

function pick(payload: Record<string, unknown>, names: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(names.filter((name) => name in payload).map((n) => [n, payload[n]]));
}

/** The event with its words replaced, keeping what names a tool or times the call. */
export function withholdEvent(event: Event): Event {
  const { payload } = event;
  switch (event.kind) {
    case 'text':
      return { ...event, payload: { text: TEXT_WITHHELD, bytes: sizeOf(payload.text) } };
    case 'tool_call':
      return {
        ...event,
        payload: {
          ...pick(payload, ['tool', 'tool_call_id']),
          input: TEXT_WITHHELD,
          bytes: sizeOf(payload.input),
        },
      };
    case 'tool_result':
      return {
        ...event,
        payload: {
          ...pick(payload, ['tool', 'tool_call_id', 'ms']),
          output: TEXT_WITHHELD,
          bytes: sizeOf(payload.output),
        },
      };
    case 'tool_error':
      return {
        ...event,
        payload: {
          ...pick(payload, ['tool', 'tool_call_id', 'ms']),
          error: TEXT_WITHHELD,
          bytes: sizeOf(payload.error),
        },
      };
    case 'error':
      return {
        ...event,
        payload: { ...pick(payload, ['name', 'aborted']), message: TEXT_WITHHELD },
      };
    default:
      return event;
  }
}
