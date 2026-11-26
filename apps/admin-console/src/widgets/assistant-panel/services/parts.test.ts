import { expect, it } from 'vitest';
import {
  drawMessage,
  groupParts,
  readParts,
  stepText,
} from '#/widgets/assistant-panel/services/parts';

it('keeps text and tool steps, and drops what the log does not draw', () => {
  const parts = readParts([
    { type: 'step-start' },
    { type: 'reasoning', text: 'secret thoughts' },
    { type: 'text', text: 'Here is the list.' },
    { type: 'data-turn_end', data: { stopReason: 'done' } },
    { type: 'tool-list_subjects', toolCallId: 'c1', state: 'output-available' },
    { type: 'source-url', url: 'https://example.com' },
    { type: 'file', url: 'data:text/plain,x' },
  ]);
  expect(parts).toEqual([
    { kind: 'text', text: 'Here is the list.' },
    { kind: 'tool', id: 'c1', name: 'list_subjects', state: 'done' },
  ]);
});

it('reads a dynamic tool by its own name', () => {
  expect(
    readParts([
      { type: 'dynamic-tool', toolName: 'get_client', toolCallId: 'c2', state: 'input-available' },
    ]),
  ).toEqual([{ kind: 'tool', id: 'c2', name: 'get_client', state: 'running' }]);
});

it.each([
  ['input-streaming', 'running'],
  ['input-available', 'running'],
  ['approval-responded', 'running'],
  ['approval-requested', 'waiting'],
  ['output-available', 'done'],
  ['output-error', 'failed'],
  ['output-denied', 'denied'],
] as const)('maps the tool state %s to %s', (state, expected) => {
  const [part] = readParts([{ type: 'tool-x', toolCallId: 'c', state }]);
  expect(part).toMatchObject({ kind: 'tool', state: expected });
});

it('skips a part with a shape it does not know rather than guessing', () => {
  expect(
    readParts([
      { type: 'text' },
      { type: 'text', text: 7 },
      { type: 'tool-x', state: 'output-available' },
      { type: 'tool-x', toolCallId: 'c', state: 'mystery' },
      { text: 'no type' },
      'nope',
      null,
    ]),
  ).toEqual([]);
});

it('words a step in plain terms and never shows the model any markup', () => {
  expect(stepText('list_subjects', 'running')).toBe('Listing subjects');
  expect(stepText('get_client', 'done')).toBe('Read client');
  expect(stepText('count_audit', 'running')).toBe('Counting audit');
  expect(stepText('create_client', 'waiting')).toBe('Create client: waiting for you');
  expect(stepText('list_roles', 'failed')).toBe('Listing roles failed');
  expect(stepText('delete_group', 'denied')).toBe('Delete group: refused');
});

it('groups the steps that run together, between the text that comes before and after', () => {
  const tool = (id: string) => ({
    kind: 'tool' as const,
    id,
    name: 'list_roles',
    state: 'done' as const,
  });
  expect(
    groupParts([
      { kind: 'text', text: 'One' },
      tool('a'),
      tool('b'),
      { kind: 'text', text: 'Two' },
      tool('c'),
    ]),
  ).toEqual([
    { kind: 'text', text: 'One' },
    { kind: 'steps', steps: [tool('a'), tool('b')] },
    { kind: 'text', text: 'Two' },
    { kind: 'steps', steps: [tool('c')] },
  ]);
  expect(groupParts([])).toEqual([]);
});

it('draws a message as its blocks, with the steps worded and toned, and a person’s words as typed', () => {
  const message = drawMessage('m', 'assistant', [
    { kind: 'text', text: 'One.\n\nTwo' },
    { kind: 'tool', id: 't', name: 'list_roles', state: 'failed' },
  ]);
  expect(message.blocks).toEqual([
    { kind: 'text', settled: ['One.'], open: 'Two' },
    {
      kind: 'steps',
      steps: [{ id: 't', text: 'Listing roles failed', label: 'Failed', tone: 'danger' }],
    },
  ]);
  expect(drawMessage('u', 'user', [{ kind: 'text', text: 'a\nb' }]).typed).toBe('a\nb');
});
