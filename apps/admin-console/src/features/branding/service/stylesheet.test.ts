import { MAX_STYLESHEET_BYTES, MAX_TEMPLATE_BYTES } from '@odudu/contracts';
import type { FieldError, ThemeView } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import {
  PROBLEMS_SHOWN,
  firstProblems,
  NO_OUTCOME,
  NO_PROBLEMS,
  publishedStylesheetProblems,
  STYLESHEET_UNPUBLISHABLE,
  sizeReading,
  STYLESHEET_OVER,
  STYLESHEET_REFUSALS,
  STYLESHEET_REFUSED,
  stylesheetHold,
  stylesheetProblems,
  stylesheetRequest,
  stylesheetSize,
  stylesheetValues,
  publishedTemplateProblems,
  templateProblems,
  TEMPLATE_UNPUBLISHABLE,
  templateSize,
  TEMPLATE_REFUSED,
} from '#/features/branding/service';
import { draftedView, EMPTY, themeView } from '#/testing/brandingFixtures';

const error = (changes: Partial<FieldError>): FieldError => ({
  path: 'stylesheet',
  message: 'The server’s words.',
  ...changes,
});

describe('the size of a text', () => {
  it('is counted in bytes, which is what the server bounds', () => {
    expect(sizeReading('abc', 10)).toEqual({ text: '3 of 10 bytes.', over: false });
    expect(sizeReading('é', 10).text).toBe('2 of 10 bytes.');
    expect(sizeReading('€€€€', 10)).toEqual({
      text: '2 bytes over the limit of 10.',
      over: true,
    });
  });

  it('is held to the stylesheet’s and the template’s own limits', () => {
    expect(stylesheetSize('').text).toBe(
      `0 of ${MAX_STYLESHEET_BYTES.toLocaleString('en')} bytes.`,
    );
    expect(templateSize('').text).toContain(MAX_TEMPLATE_BYTES.toLocaleString('en'));
    expect(stylesheetSize('x'.repeat(MAX_STYLESHEET_BYTES)).over).toBe(false);
    expect(stylesheetSize('x'.repeat(MAX_STYLESHEET_BYTES + 1)).over).toBe(true);
  });

  it('holds Save only while the stylesheet is over', () => {
    expect(stylesheetHold('a {}')).toBeUndefined();
    expect(stylesheetHold('x'.repeat(MAX_STYLESHEET_BYTES + 1))).toBe(STYLESHEET_OVER);
  });
});

describe('what a refused stylesheet says', () => {
  it('says nothing when there are neither refusals nor a save’s own error', () => {
    expect(stylesheetProblems([], undefined)).toEqual(NO_PROBLEMS);
  });

  it('marks a refusal that names a line, in the console’s words with what it quoted', () => {
    const problems = stylesheetProblems(
      [error({ code: 'property-not-allowed', detail: 'behavior', line: 4, column: 3 })],
      'The server’s words.',
    );
    expect(problems.lines).toEqual([
      { line: 4, text: `${STYLESHEET_REFUSALS['property-not-allowed'] ?? ''} (behavior)` },
    ]);
    expect(problems.message).toBe(STYLESHEET_REFUSED);
  });

  it('says a refusal with no line under the editor, and does not mark it', () => {
    const problems = stylesheetProblems(
      [error({ code: 'too-large', detail: '200000 bytes', line: null, column: null })],
      'x',
    );
    expect(problems.lines).toEqual([]);
    expect(problems.message).toBe(
      `${STYLESHEET_REFUSED} ${STYLESHEET_REFUSALS['too-large'] ?? ''} (200000 bytes)`,
    );
  });

  it('falls back to the server’s words for a code it does not know', () => {
    const problems = stylesheetProblems([error({ code: 'new-code', line: 2 })], 'x');
    expect(problems.lines).toEqual([{ line: 2, text: 'The server’s words.' }]);
  });

  it('keeps the save’s own words when the refusal names nothing of the stylesheet', () => {
    expect(
      stylesheetProblems([error({ path: 'templates.sign-in', line: 1 })], 'A saved sentence.'),
    ).toEqual({ lines: [], message: 'A saved sentence.' });
    expect(stylesheetProblems([], 'A saved sentence.').message).toBe('A saved sentence.');
  });

  it('marks at most as many as it lists, and counts the rest', () => {
    const many = Array.from({ length: PROBLEMS_SHOWN + 5 }, (_, index) =>
      error({ code: 'selector-not-allowed', line: index + 1 }),
    );
    const problems = stylesheetProblems(many, 'x');
    expect(problems.lines).toHaveLength(PROBLEMS_SHOWN);
    expect(problems.message).toBe(`${STYLESHEET_REFUSED} And 5 more problems.`);
  });

  it('says what a refused publish says of a stylesheet only while the draft is the one refused', () => {
    const errors = [error({ code: 'property-not-allowed', detail: 'x', line: 5 })];
    const outcome = { ...NO_OUTCOME, errors, atTag: '"d1"' };
    const marked = publishedStylesheetProblems(outcome, '"d1"', false);
    expect(marked.lines).toEqual([
      { line: 5, text: `${STYLESHEET_REFUSALS['property-not-allowed'] ?? ''} (x)` },
    ]);
    expect(marked.message).toBe(STYLESHEET_UNPUBLISHABLE);
    expect(publishedStylesheetProblems(outcome, '"d2"', false)).toEqual(NO_PROBLEMS);
    expect(publishedStylesheetProblems(outcome, '"d1"', true)).toEqual(NO_PROBLEMS);
    expect(publishedStylesheetProblems(NO_OUTCOME, '"d1"', false)).toEqual(NO_PROBLEMS);
  });

  it('prefers the save’s reading to the publish’s', () => {
    const none = { lines: [], message: undefined };
    const saved = { lines: [], message: 'saved' };
    const published = { lines: [], message: 'published' };
    expect(firstProblems(saved, published)).toBe(saved);
    expect(firstProblems(none, published)).toBe(published);
  });
});

describe('what a refused template says', () => {
  it('marks its own kind’s lines, in the server’s words', () => {
    const errors = [
      error({ path: 'templates.sign-in', message: 'Needs {{form.close}} once.', line: 2 }),
      error({ path: 'templates.consent', message: 'Elsewhere.', line: 1 }),
    ];
    expect(templateProblems('sign-in', errors, 'x')).toEqual({
      lines: [{ line: 2, text: 'Needs {{form.close}} once.' }],
      message: TEMPLATE_REFUSED,
    });
    expect(templateProblems('notice', errors, 'Their words.').message).toBe('Their words.');
  });
});

describe('what a refused publish says of a template', () => {
  const errors = [
    error({ path: 'templates.sign-in', message: 'Needs {{form.close}}.', line: 2 }),
    error({ path: 'templates.consent', message: 'Elsewhere.', line: 1 }),
  ];
  const outcome = { ...NO_OUTCOME, errors, atTag: '"d1"' };

  it('marks its own kind’s line while the refused draft stands, and no other kind’s', () => {
    expect(publishedTemplateProblems('sign-in', outcome, '"d1"', false)).toEqual({
      lines: [{ line: 2, text: 'Needs {{form.close}}.' }],
      message: TEMPLATE_UNPUBLISHABLE,
    });
    expect(publishedTemplateProblems('notice', outcome, '"d1"', false)).toEqual(NO_PROBLEMS);
  });

  it('lets go once the draft moved or the template was edited', () => {
    expect(publishedTemplateProblems('sign-in', outcome, '"d2"', false)).toEqual(NO_PROBLEMS);
    expect(publishedTemplateProblems('sign-in', outcome, '"d1"', true)).toEqual(NO_PROBLEMS);
  });
});

describe('the stylesheet in a request', () => {
  it('is none when empty, and is carried with the rest of the draft', () => {
    const view = draftedView() as ThemeView;
    expect(stylesheetValues(themeView() as ThemeView)).toEqual({ stylesheet: '' });
    const request = stylesheetRequest(view, { stylesheet: 'a { color: red }' });
    expect(request.stylesheet).toBe('a { color: red }');
    expect(request.tokens).toEqual(view.draft?.tokens);
    expect(stylesheetRequest(view, { stylesheet: '  \n' }).stylesheet).toBeNull();
  });

  it('reads the draft’s stylesheet back', () => {
    const view = themeView({ draft: { ...EMPTY, stylesheet: 'a {}' } }) as ThemeView;
    expect(stylesheetValues(view)).toEqual({ stylesheet: 'a {}' });
  });
});
