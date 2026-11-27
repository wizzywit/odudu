import { expect, it } from 'vitest';
import { contentSize, nearBottom } from '#/widgets/assistant-panel/services/scroll';
import { docked } from '#/widgets/assistant-panel/services/layout';

it('keeps following the log while the person is at the bottom, within a few pixels', () => {
  expect(nearBottom({ scrollTop: 600, clientHeight: 400, scrollHeight: 1000 })).toBe(true);
  expect(nearBottom({ scrollTop: 590, clientHeight: 400, scrollHeight: 1000 })).toBe(true);
  expect(nearBottom({ scrollTop: 400, clientHeight: 400, scrollHeight: 1000 })).toBe(false);
});

it('stops following as soon as the person scrolls up to read', () => {
  expect(nearBottom({ scrollTop: 0, clientHeight: 400, scrollHeight: 1000 })).toBe(false);
});

it('follows a log that has not filled the view', () => {
  expect(nearBottom({ scrollTop: 0, clientHeight: 400, scrollHeight: 300 })).toBe(true);
});

it('counts what is in the log, so a change in it is one a view can watch for', () => {
  const messages = [
    {
      id: 'a',
      role: 'user' as const,
      typed: '',
      blocks: [],
      parts: [{ kind: 'text' as const, text: 'Hi' }],
    },
    {
      id: 'b',
      role: 'assistant' as const,
      typed: '',
      blocks: [],
      parts: [
        {
          kind: 'tool' as const,
          id: 't',
          name: 'list_roles',
          state: 'running' as const,
          input: {},
          error: null,
        },
        { kind: 'text' as const, text: 'Hello' },
      ],
    },
  ];
  const before = contentSize(messages);
  expect(
    contentSize([
      ...messages,
      { id: 'c', role: 'user' as const, typed: '', blocks: [], parts: [] },
    ]),
  ).toBeGreaterThan(before);
  expect(
    contentSize([
      messages[0] ?? { id: 'x', role: 'user' as const, typed: '', blocks: [], parts: [] },
      {
        ...(messages[1] ?? { id: 'y', role: 'assistant' as const, typed: '', blocks: [] }),
        parts: [{ kind: 'text' as const, text: 'Hello there' }],
      },
    ]),
  ).not.toBe(before);
});

it('docks the panel from 1280 pixels and lays it over the page below', () => {
  expect(docked(1280)).toBe(true);
  expect(docked(1279)).toBe(false);
});
