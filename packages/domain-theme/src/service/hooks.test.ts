import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PAGE_KINDS } from '@odudu/kernel';
import { describe, expect, it } from 'vitest';
import {
  CSS_ELEMENTS,
  CSS_HOOKS,
  CSS_HOOKS_VERSION,
  CSS_PSEUDO_CLASSES,
  CSS_PSEUDO_ELEMENTS,
  CSS_TOKENS,
  PAGE_KIND_HOOKS,
  RENDERED_HOOKS,
} from '#/service/hooks';
import { checkStylesheet } from '#/service/stylesheet';

const PACKAGES = join(import.meta.dirname, '..', '..', '..');

// The art of the not-found page builds its class attribute at run time and
// is never themed, so its classes are not hooks.
const UNTHEMED = new Set(['packages/protocol-oidc/src/view/lost-art.ts']);

// Every class a server view renders, found in the sources: the view
// layers, and the password-rules and brand-line markup the kernel shares with them.
const sources = (): string[] => {
  const files: string[] = [
    join(PACKAGES, 'kernel', 'src', 'password-hints.ts'),
    join(PACKAGES, 'kernel', 'src', 'page.ts'),
  ];
  for (const pkg of readdirSync(PACKAGES)) {
    const dir = join(PACKAGES, pkg, 'src', 'view');
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const themed =
        name.endsWith('.ts') &&
        !name.endsWith('.test.ts') &&
        !UNTHEMED.has(`packages/${pkg}/src/view/${name}`);
      if (themed) files.push(join(dir, name));
    }
  }
  return files.map((file) => readFileSync(file, 'utf8'));
};

const renderedClasses = (): Set<string> => {
  const found = new Set<string>();
  for (const source of sources()) {
    for (const match of source.matchAll(/class="([^"$]*)"/g)) {
      for (const name of (match[1] ?? '').split(/\s+/).filter(Boolean)) found.add(name);
    }
  }
  return found;
};

describe('CSS hooks', () => {
  // Renaming or removing a hook, or a page kind, breaks tenant stylesheets:
  // change this list and CSS_HOOKS_VERSION together, on purpose.
  it('is the published list for its version', () => {
    expect(CSS_HOOKS_VERSION).toBe(1);
    expect(CSS_HOOKS).toEqual([
      'alert',
      'brand',
      'choice',
      'context',
      'hint',
      'intro',
      'links',
      'logo',
      'logo-dark',
      'logo-light',
      'mark',
      'page',
      'quiet',
      'rules',
      'rules-head',
      'secondary',
      'tenant',
      'wordmark',
      'page-sign-in',
      'page-consent',
      'page-select-account',
      'page-logout-confirm',
      'page-totp-enrolment',
      'page-passkey-enrolment',
      'page-recovery-codes',
      'page-update-password',
      'page-required-action',
      'page-registration',
      'page-reset',
      'page-verification',
      'page-required-actions',
      'page-authorize-error',
      'page-email-unverified',
      'page-logged-out',
      'page-notice',
    ]);
  });

  it('lists only classes some server view renders', () => {
    const text = sources().join('\n');
    for (const name of RENDERED_HOOKS) {
      expect(new RegExp(`class="[^"]*\\b${name}\\b[^"]*"`).test(text), name).toBe(true);
    }
  });

  // The page-<kind> hooks are the only listed hooks no renderer emits yet;
  // once one does, it moves into RENDERED_HOOKS and this fails until it does.
  it('lists only the page-<kind> hooks as not yet emitted', () => {
    const text = sources().join('\n');
    const rest = CSS_HOOKS.filter((name) => !RENDERED_HOOKS.includes(name));
    expect(rest).toHaveLength(17);
    for (const name of rest) {
      expect(name.startsWith('page-'), name).toBe(true);
      expect(text.includes(name), name).toBe(false);
    }
  });

  it('names every class the server pages render today', () => {
    const rendered = renderedClasses();
    expect(rendered.size).toBeGreaterThan(5);
    for (const name of rendered) expect(CSS_HOOKS, name).toContain(name);
  });

  it('carries a page- hook for each of the 17 page kinds', () => {
    const kinds = Object.keys(PAGE_KINDS);
    expect(kinds).toHaveLength(17);
    for (const kind of kinds) expect(CSS_HOOKS).toContain(`page-${kind}`);
  });

  it('has no duplicates and only plain class names', () => {
    expect(new Set(CSS_HOOKS).size).toBe(CSS_HOOKS.length);
    for (const name of CSS_HOOKS) expect(name).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it('lists the element types a selector may use', () => {
    expect(CSS_ELEMENTS).toEqual(
      'main h1 h2 h3 p a ul ol li label input button small code img span div section header footer form'.split(
        ' ',
      ),
    );
  });

  it('lists every token the server stylesheet reads', () => {
    const css = readFileSync(join(PACKAGES, 'instrument', 'src', 'pages.css'), 'utf8');
    const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
    expect(used.size).toBeGreaterThan(10);
    for (const token of used) expect(CSS_TOKENS, token).toContain(token);
  });
});

// What a tenant may write in a selector is what the checker accepts, so each
// list is held to the checker itself and not to a copy of its source.
describe('the lists the checker accepts', () => {
  const accepted = (css: string): boolean => checkStylesheet(css).length === 0;

  it('splits CSS_HOOKS into the rendered classes and the page-<kind> classes', () => {
    expect([...RENDERED_HOOKS, ...PAGE_KIND_HOOKS]).toEqual(CSS_HOOKS);
    expect(PAGE_KIND_HOOKS).toEqual(Object.keys(PAGE_KINDS).map((kind) => `page-${kind}`));
  });

  it('accepts a rule for each class, element, state and part it lists', () => {
    for (const name of CSS_HOOKS) expect(accepted(`.${name} { color: inherit; }`), name).toBe(true);
    for (const name of CSS_ELEMENTS)
      expect(accepted(`${name} { color: inherit; }`), name).toBe(true);
    for (const name of CSS_PSEUDO_CLASSES) {
      expect(accepted(`a:${name} { color: inherit; }`), name).toBe(true);
    }
    for (const name of CSS_PSEUDO_ELEMENTS) {
      expect(accepted(`input::${name} { color: inherit; }`), name).toBe(true);
    }
  });

  it('accepts each token in var() and refuses one it does not list', () => {
    for (const token of CSS_TOKENS) {
      expect(accepted(`.page { color: var(${token}); }`), token).toBe(true);
    }
    expect(accepted('.page { color: var(--not-a-token); }')).toBe(false);
    expect(accepted('.page { --mine: red; }')).toBe(false);
  });

  it('refuses a class, an element and a state that no list holds', () => {
    expect(accepted('.nonesuch { color: inherit; }')).toBe(false);
    expect(accepted('table { color: inherit; }')).toBe(false);
    expect(accepted('a:visited { color: inherit; }')).toBe(false);
    expect(accepted('a::marker { color: inherit; }')).toBe(false);
  });

  it('lists no state or part twice', () => {
    expect(new Set(CSS_PSEUDO_CLASSES).size).toBe(CSS_PSEUDO_CLASSES.length);
    expect(new Set(CSS_PSEUDO_ELEMENTS).size).toBe(CSS_PSEUDO_ELEMENTS.length);
  });
});
