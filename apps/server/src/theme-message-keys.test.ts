import { isMailMessageKey, MAIL_MESSAGES } from '@odudu/email';
import { PAGE_KINDS, scanSlots, type PageKind } from '@odudu/kernel';
import { describe, expect, it } from 'vitest';
import {
  isOverridableMessageKey,
  isThemeMessageKey,
  overrideProblemFor,
  pageKindOwners,
  pageMessageCatalogue,
} from '#/theme-message-keys';

const KINDS = Object.keys(PAGE_KINDS) as PageKind[];

describe('isThemeMessageKey', () => {
  it('has exactly one package fill every page kind', () => {
    for (const kind of KINDS) expect(pageKindOwners(kind), kind).toBe(1);
  });

  it('accepts a key of the package that fills the kind and no other package’s', () => {
    expect(isThemeMessageKey('sign-in', 'login.title')).toBe(true);
    expect(isThemeMessageKey('totp-enrolment', 'login.title')).toBe(false);
  });

  it('refuses a key that is in no catalogue, and Object.prototype names', () => {
    expect(isThemeMessageKey('sign-in', 'login.nonesuch')).toBe(false);
    expect(isThemeMessageKey('sign-in', 'constructor')).toBe(false);
    expect(isThemeMessageKey('sign-in', '__proto__')).toBe(false);
  });
});

describe('isOverridableMessageKey', () => {
  it('accepts a key of any page catalogue', () => {
    expect(isOverridableMessageKey('login.title')).toBe(true);
    expect(isOverridableMessageKey('updatePassword.rule.maxLength')).toBe(true);
    expect(isOverridableMessageKey('verification.succeeded.title')).toBe(true);
  });

  it('accepts every key a mail reads, derived from the mail catalogue', () => {
    expect(Object.keys(MAIL_MESSAGES).length).toBeGreaterThan(50);
    for (const key of Object.keys(MAIL_MESSAGES)) {
      expect(isOverridableMessageKey(key), key).toBe(true);
    }
  });

  it('keeps a mail key out of every page, and a page key out of the mail', () => {
    for (const key of Object.keys(MAIL_MESSAGES)) {
      for (const kind of KINDS) expect(isThemeMessageKey(kind, key), `${kind} ${key}`).toBe(false);
    }
    for (const section of pageMessageCatalogue().sections) {
      if (section.kinds.length === 0) continue;
      for (const { key } of section.messages) expect(isMailMessageKey(key), key).toBe(false);
    }
  });

  it('refuses a key in none, and Object.prototype names', () => {
    expect(isOverridableMessageKey('login.nonesuch')).toBe(false);
    expect(isOverridableMessageKey('')).toBe(false);
    expect(isOverridableMessageKey('constructor')).toBe(false);
    expect(isOverridableMessageKey('__proto__')).toBe(false);
  });
});

describe('pageMessageCatalogue', () => {
  const sections = pageMessageCatalogue().sections;

  it('lists, for each page kind, exactly the keys a template of it may name', () => {
    for (const kind of KINDS) {
      const section = sections.find((entry) => entry.kinds.includes(kind));
      expect(section, kind).toBeDefined();
      const listed = new Set(section?.messages.map((message) => message.key));
      expect(listed.size, kind).toBeGreaterThan(0);
      for (const key of listed) expect(isThemeMessageKey(kind, key), `${kind} ${key}`).toBe(true);
      for (const other of sections) {
        if (other === section) continue;
        for (const message of other.messages) {
          if (!listed.has(message.key)) expect(isThemeMessageKey(kind, message.key)).toBe(false);
        }
      }
    }
  });

  it('ends with one section of the mail messages, which fills no page kind', () => {
    const mail = sections.at(-1);
    expect(mail?.kinds).toEqual([]);
    expect(mail?.messages.map((message) => message.key).sort()).toEqual(
      Object.keys(MAIL_MESSAGES).sort(),
    );
    expect(sections.filter((section) => section.kinds.length === 0)).toHaveLength(1);
  });

  it('puts every page kind in one section and no section twice', () => {
    const seen = sections.flatMap((section) => section.kinds);
    expect([...seen].sort()).toEqual([...KINDS].sort());
  });

  it('lists only keys an override accepts, each once per section and in key order', () => {
    for (const section of sections) {
      const keys = section.messages.map((message) => message.key);
      expect(keys).toEqual([...keys].sort());
      expect(new Set(keys).size).toBe(keys.length);
      for (const key of keys) expect(isOverridableMessageKey(key), key).toBe(true);
    }
  });

  it('lists only keys a template can write as {{t "key"}} in a page section, so a pick is never malformed', () => {
    for (const section of sections.filter((entry) => entry.kinds.length > 0)) {
      for (const { key } of section.messages) {
        expect(scanSlots(`{{t "${key}"}}`), key).toEqual([
          { kind: 'text', name: key, index: 0, end: key.length + 8 },
        ]);
      }
    }
  });

  it('carries the English text, never empty, and is a few hundred small entries', () => {
    const all = sections.flatMap((section) => section.messages);
    for (const message of all) expect(message.en.length, message.key).toBeGreaterThan(0);
    expect(all.length).toBeGreaterThan(100);
    expect(all.length).toBeLessThan(1000);
    expect(JSON.stringify(sections).length).toBeLessThan(200_000);
  });
});

describe('overrideProblemFor', () => {
  it('holds an override to the syntax rules and to the arguments its page supplies', () => {
    expect(overrideProblemFor('login.context', 'to reach {client}')).toBeNull();
    expect(overrideProblemFor('login.context', 'to reach {app}')).toContain('{app}');
    expect(overrideProblemFor('login.title', 'Hi {name')).toContain('not a valid message');
    expect(overrideProblemFor('login.title', '')).toContain('empty');
  });

  it('holds a mail key to the arguments its English text reads', () => {
    expect(overrideProblemFor('reset.subject', 'For {tenant}')).toBeNull();
    expect(overrideProblemFor('reset.subject', 'For {nobody}')).toContain('{nobody}');
    expect(overrideProblemFor('mail.copyright', '(c) {year}')).toBeNull();
    expect(overrideProblemFor('reset.button', 'Go {tenant}')).toContain('{tenant}');
  });

  it('asks only the syntax rules of a key it has no page text for', () => {
    expect(overrideProblemFor('login.nonesuch', 'Hello, {name}')).toBeNull();
    expect(overrideProblemFor('constructor', 'Hello, {name}')).toBeNull();
  });

  it('knows every catalogue message by its own text', () => {
    for (const { messages } of pageMessageCatalogue().sections) {
      for (const { key, en } of messages) expect(overrideProblemFor(key, en), key).toBeNull();
    }
  });
});
