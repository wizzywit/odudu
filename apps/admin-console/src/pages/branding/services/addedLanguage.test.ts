import { describe, expect, it, vi } from 'vitest';
import { addLanguage, addsOnKey, languageAdded } from '#/pages/branding/services/addedLanguage';

describe('adding a language', () => {
  it('joins a tag the server takes, as typed', () => {
    expect(languageAdded(['en'], ' pt-BR ')).toEqual({ supported: ['en', 'pt-BR'], problem: null });
  });

  it('refuses nothing chosen, a tag that is not one, and one already offered in any case', () => {
    expect(languageAdded(['en'], '').problem).toMatch(/Choose a language/u);
    expect(languageAdded(['en'], 'English').supported).toBeNull();
    expect(languageAdded(['en'], 'English').problem).toMatch(/type a tag/u);
    expect(languageAdded(['en', 'fr-CA'], 'FR-ca').problem).toBe(
      'That language is already offered.',
    );
  });

  it('refuses a thirty-third', () => {
    const full = Array.from(
      { length: 32 },
      (_, i) => `x${String.fromCharCode(97 + (i % 26))}${String(i)}`,
    );
    expect(languageAdded(full, 'fr').problem).toMatch(/at most 32/u);
  });
});

describe('adding what was typed', () => {
  it('hands on the new list and clears the problem, or hands on only the problem', () => {
    const to = { problem: vi.fn(), accepted: vi.fn() };
    addLanguage(['en'], 'fr', to);
    expect(to.problem).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(to.accepted).toHaveBeenCalledExactlyOnceWith(['en', 'fr']);

    const refused = { problem: vi.fn(), accepted: vi.fn() };
    addLanguage(['en'], 'EN', refused);
    expect(refused.problem).toHaveBeenCalledExactlyOnceWith('That language is already offered.');
    expect(refused.accepted).not.toHaveBeenCalled();
  });

  it('is done by Enter, except when Enter chooses another option', () => {
    expect(addsOnKey('Enter', false)).toBe(true);
    expect(addsOnKey('Enter', true)).toBe(false);
    expect(addsOnKey('a', false)).toBe(false);
  });
});
