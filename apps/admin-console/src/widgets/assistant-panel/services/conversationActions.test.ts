import { expect, it } from 'vitest';
import {
  actionFailureText,
  exportFileName,
  exportMediaType,
  isGone,
} from '#/widgets/assistant-panel/services/conversationActions';

function refused(status: number, type = 'about:blank') {
  return { ok: false, kind: 'problem', problem: { type, title: 'x', status } } as const;
}

it('says why a delete is held, in the person’s words', () => {
  expect(actionFailureText('delete', refused(409, 'about:blank#conversation-reported'))).toMatch(
    /reported .* kept for review.*archive it, but not delete/u,
  );
  expect(actionFailureText('delete', refused(409, 'about:blank#conversation-busy'))).toMatch(
    /still running.*Stop it/u,
  );
});

it('says a conversation that is not there is gone, whatever was asked', () => {
  for (const action of ['archive', 'restore', 'delete', 'export'] as const) {
    expect(actionFailureText(action, refused(404))).toBe('This conversation is already gone.');
  }
  expect(isGone(refused(404))).toBe(true);
  expect(isGone(refused(500))).toBe(false);
  expect(isGone({ ok: false, kind: 'network' })).toBe(false);
});

it('names the action that could not be done for anything else, and never a raw error', () => {
  expect(actionFailureText('archive', refused(500))).toBe(
    'The conversation could not be archived. Try again.',
  );
  expect(actionFailureText('export', { ok: false, kind: 'network' })).toBe(
    'The conversation could not be exported. Try again.',
  );
  expect(actionFailureText('delete', refused(409))).toBe(
    'The conversation could not be deleted. Try again.',
  );
});

it('names an export file by the conversation and its format', () => {
  expect(exportFileName('c1', 'markdown')).toBe('conversation-c1.md');
  expect(exportFileName('c1', 'json')).toBe('conversation-c1.json');
  expect(exportMediaType('json', null)).toBe('application/json');
  expect(exportMediaType('markdown', 'text/markdown; charset=utf-8')).toBe(
    'text/markdown; charset=utf-8',
  );
});
