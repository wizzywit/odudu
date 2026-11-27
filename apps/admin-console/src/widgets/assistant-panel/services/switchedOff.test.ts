import { expect, it } from 'vitest';
import { assistantSwitchedOff } from '#/widgets/assistant-panel/services/switchedOff';

const OFF = JSON.stringify({
  error: { type: 'mcp:assistant_unavailable', title: 'The assistant is switched off' },
});

function tool(output: unknown) {
  return {
    role: 'assistant',
    parts: [{ type: 'tool-list_clients', state: 'output-available', output }],
  };
}

it('sees a tool answer that says the assistant is switched off', () => {
  expect(assistantSwitchedOff([tool(OFF)])).toBe(true);
  expect(assistantSwitchedOff([tool(`<fenced>${OFF}</fenced>`)])).toBe(true);
});

it('does not take other tool answers, or words that spell it, for that', () => {
  expect(assistantSwitchedOff([tool(JSON.stringify({ data: [] }))])).toBe(false);
  expect(assistantSwitchedOff([tool(JSON.stringify({ name: 'mcp:assistant_unavailable' }))])).toBe(
    false,
  );
  expect(assistantSwitchedOff([tool({ error: 1 })])).toBe(false);
  expect(assistantSwitchedOff([{ role: 'assistant', parts: [{ type: 'text', text: OFF }] }])).toBe(
    false,
  );
  expect(assistantSwitchedOff([{ role: 'user', parts: [{ output: OFF }] }])).toBe(false);
  expect(assistantSwitchedOff([])).toBe(false);
});
