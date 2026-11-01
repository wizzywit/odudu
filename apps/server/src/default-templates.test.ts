import { DEFAULT_TEMPLATES as ACCOUNT } from '@odudu/account';
import { DEFAULT_TEMPLATES as AUTHN_FLOWS } from '@odudu/authn-flows';
import { checkTemplate } from '@odudu/domain-theme';
import { PAGE_KINDS, type PageKind } from '@odudu/kernel';
import { DEFAULT_TEMPLATES as PROTOCOL_OIDC } from '@odudu/protocol-oidc';
import { describe, expect, it } from 'vitest';
import { isThemeMessageKey } from '#/theme-message-keys';

interface Owner {
  name: string;
  templates: Partial<Record<PageKind, string>>;
}

// One entry per package that renders pages through a default template.
const OWNERS: Owner[] = [
  { name: 'protocol-oidc', templates: PROTOCOL_OIDC },
  { name: 'account', templates: ACCOUNT },
  { name: 'authn-flows', templates: AUTHN_FLOWS },
];

// Kinds whose renderers have not been converted yet; a kind leaves this list
// when its package's table joins OWNERS.
const NOT_CONVERTED: PageKind[] = [];

const kindsOf = (templates: Partial<Record<PageKind, string>>): PageKind[] =>
  Object.keys(templates) as PageKind[];

describe('the default templates', () => {
  it('leaves no kind without an owner or a note that it is not converted', () => {
    const owned = OWNERS.flatMap((owner) => kindsOf(owner.templates));
    expect([...owned, ...NOT_CONVERTED].sort()).toEqual(Object.keys(PAGE_KINDS).sort());
  });

  for (const { name, templates } of OWNERS) {
    describe(name, () => {
      for (const kind of kindsOf(templates)) {
        const template = templates[kind] ?? '';

        it(`passes the check a saved template passes: ${kind}`, () => {
          expect(checkTemplate(kind, template)).toEqual([]);
        });

        it(`uses only keys of the catalogue its page is filled from: ${kind}`, () => {
          const options = { isMessageKey: (key: string) => isThemeMessageKey(kind, key) };
          expect(checkTemplate(kind, template, options)).toEqual([]);
        });

        it(`places every required part: ${kind}`, () => {
          for (const part of PAGE_KINDS[kind].required) {
            expect(template, part).toContain(`{{${part}}}`);
          }
        });
      }
    });
  }
});

describe('a theme template that loses what the server must show', () => {
  it('is refused for a redirecting page that omits its frames and script', () => {
    const codes = checkTemplate('logged-out', '{{message}}').map((issue) => issue.detail);
    expect(codes).toEqual(expect.arrayContaining(['frames', 'script']));
  });

  it('is refused for a consent page that omits the client', () => {
    const own = '{{form.open}}{{scopes}}{{submit.allow}}{{submit.deny}}{{form.close}}';
    expect(checkTemplate('consent', own).map((issue) => issue.detail)).toContain('client');
  });

  it('is refused for a sign-in page that omits the error', () => {
    const own = '{{form.open}}{{fields}}{{submit}}{{form.close}}';
    expect(checkTemplate('sign-in', own).map((issue) => issue.detail)).toContain('error');
  });
});

describe('an account form template that loses what the server must show', () => {
  const details = (kind: 'registration' | 'reset' | 'required-actions', own: string): string[] =>
    checkTemplate(kind, own).map((issue) => issue.detail);

  it.each(['registration', 'reset'] as const)('is refused for %s without the error', (kind) => {
    const own = '{{form.open}}{{fields}}{{submit}}{{form.close}}';
    expect(details(kind, own)).toContain('error');
  });

  it('is refused for required actions that omit the list of actions or the error', () => {
    const own = '{{form.open}}{{fields}}{{submit}}{{form.close}}';
    expect(details('required-actions', own)).toEqual(expect.arrayContaining(['actions', 'error']));
  });

  it('is refused for a verification page that omits its form', () => {
    expect(checkTemplate('verification', '{{message}}').map((issue) => issue.detail)).toEqual(
      expect.arrayContaining(['form.open', 'submit', 'form.close']),
    );
  });

  it('is refused for a registration form without its submit or its fields', () => {
    const own = '{{form.open}}{{error}}{{form.close}}';
    expect(details('registration', own)).toEqual(expect.arrayContaining(['fields', 'submit']));
  });
});

describe('a notice template', () => {
  it('is refused without its message', () => {
    expect(checkTemplate('notice', '{{links}}').map((issue) => issue.detail)).toContain('message');
  });

  it('is refused when it opens a form or places a script, which a notice has none of', () => {
    const own = '{{message}}{{form.open}}{{form.close}}{{script}}';
    expect(checkTemplate('notice', own).map((issue) => issue.detail)).toEqual(
      expect.arrayContaining(['form.open', 'form.close', 'script']),
    );
  });
});

describe('an authn-flows template that loses what the server must show', () => {
  const details = (kind: PageKind, own: string): string[] =>
    checkTemplate(kind, own).map((issue) => issue.detail);

  it('is refused for a TOTP enrolment without the offer, the fields or the error', () => {
    const own = '{{form.open}}{{submit}}{{form.close}}';
    expect(details('totp-enrolment', own)).toEqual(
      expect.arrayContaining(['offer', 'fields', 'error']),
    );
  });

  it('is refused for a passkey enrolment without its script or its error', () => {
    const own = '{{form.open}}{{fields}}{{submit}}{{form.close}}';
    expect(details('passkey-enrolment', own)).toEqual(expect.arrayContaining(['script', 'error']));
  });

  it('is refused for recovery codes without the codes or what is said about them', () => {
    const own = '{{form.open}}{{submit}}{{error}}{{form.close}}';
    expect(details('recovery-codes', own)).toEqual(
      expect.arrayContaining(['codes', 'instructions', 'notice']),
    );
  });

  it('is refused for an update-password form without its error', () => {
    const own = '{{form.open}}{{fields}}{{submit}}{{form.close}}';
    expect(details('update-password', own)).toContain('error');
  });

  it('is refused for a required-action page without its message', () => {
    expect(details('required-action', '')).toContain('message');
  });

  it('is refused for a required-action page that places links, which it has none of', () => {
    const issues = checkTemplate('required-action', '{{message}}{{links}}');
    expect(issues.map((issue) => [issue.code, issue.detail])).toEqual([['unknown-slot', 'links']]);
  });

  it('is refused when a script-less kind places a script', () => {
    const own = '{{message}}{{script}}';
    expect(details('required-action', own)).toContain('script');
  });
});
