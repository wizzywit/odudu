import { expect, it } from 'vitest';
import {
  PANEL_WORDING,
  ROOT_FAILURE_TEXT,
  ROUTE_FAILURE_TEXT,
  SHELL_FAILURE_TEXT,
} from '#/widgets/failure/services/wording';

const SENTENCES = [ROUTE_FAILURE_TEXT, SHELL_FAILURE_TEXT, ROOT_FAILURE_TEXT];

// The unsaved-changes guard forgets a form when its page goes, so no screen
// can truthfully say that unsaved work is kept somewhere.
it('never claims unsaved work is held, kept for you or recoverable', () => {
  for (const text of SENTENCES) {
    expect(text).not.toMatch(/\b(held|still there|restored|recovered later)\b/iu);
    expect(text).not.toMatch(/unsaved[^.]*\b(is|are) (kept|safe)/iu);
  }
});

it('says what is lost where a page that failed took its form with it', () => {
  expect(ROUTE_FAILURE_TEXT).toMatch(/not saved[^.]*cannot be recovered/iu);
});

it('promises no step it does not take', () => {
  for (const text of [...SENTENCES, ...Object.values(PANEL_WORDING)]) {
    expect(text).not.toMatch(/asks? first|each of them/iu);
  }
});
