import { DEFAULT_PAGE_LOCALE, pathAddress } from '@odudu/kernel';
import { describe, expect, it } from 'vitest';
import { en } from '#/view/messages';
import { ar } from '#/view/messages.ar';
import {
  renderRequestedUpdateProfilePage,
  renderUpdateProfilePage,
} from '#/view/update-profile-html';

const ADDRESS = pathAddress('https://idp.example', 'acme');
const FIELDS = ['name', 'birthdate', 'website', 'phone_number'];
const VALUES = { name: 'Ada', birthdate: '', website: '', phone_number: '' };

function page(
  problems: Parameters<typeof renderUpdateProfilePage>[4] = [],
  fields = FIELDS,
  values: Record<string, string> = VALUES,
): string {
  return renderUpdateProfilePage(
    'acme',
    ADDRESS,
    'sess-1',
    { fields, values },
    problems,
    DEFAULT_PAGE_LOCALE,
  ).html;
}

describe('the update-profile page', () => {
  it('posts to the required-action step for this action, bound to the sign-in', () => {
    const html = page();
    expect(html).toContain(
      'action="/tenants/acme/login-actions/required-action?action=update-profile"',
    );
    expect(html).toContain('<input type="hidden" name="auth_session_id" value="sess-1">');
  });

  it('lists the fields it is given, in order, each labelled and prefilled', () => {
    const html = page();
    const names = [...html.matchAll(/<input type="[a-z]+" name="([a-z_]+)"/gu)]
      .map((match) => match[1])
      .filter((name) => name !== 'auth_session_id');
    expect(names).toEqual(FIELDS);
    expect(html).toContain('value="Ada"');
    expect(html).toContain(en['updateProfile.field.birthdate']);
  });

  it('types a web address as a url and a phone number as tel', () => {
    const html = page();
    expect(html).toContain('type="url" name="website"');
    expect(html).toContain('type="tel" name="phone_number"');
  });

  it('shows a username field only when it is one of the fields', () => {
    expect(page()).not.toContain('name="username"');
    expect(page([], ['username', ...FIELDS], { ...VALUES, username: 'ada' })).toContain(
      'name="username"',
    );
  });

  it('escapes a value that is hostile markup', () => {
    const html = page([], FIELDS, { ...VALUES, name: '"><script>x</script>' });
    expect(html).not.toContain('<script>x</script>');
  });

  it('names every unfilled field in one alert and marks each invalid', () => {
    const html = page([{ kind: 'unfilled', fields: ['birthdate', 'website'] }]);
    expect(html).toContain('role="alert"');
    expect(html).toContain(en['updateProfile.unfilled']);
    expect(html).toMatch(/name="birthdate"[^>]*aria-invalid="true"/u);
    expect(html).toMatch(/name="website"[^>]*aria-invalid="true"/u);
    expect(html).not.toMatch(/name="name"[^>]*aria-invalid/u);
  });

  it('words a refused value by the field and why', () => {
    const html = page([{ kind: 'invalid', field: 'birthdate', reason: 'shape' }]);
    expect(html).toContain('Birthdate must be a date as YYYY-MM-DD');
    const bidi = page([{ kind: 'invalid', field: 'name', reason: 'bidi' }]);
    expect(bidi).toContain('Full name must not contain direction-control');
  });

  it('says a username is taken', () => {
    expect(
      page([{ kind: 'username_taken' }], ['username', ...FIELDS], { ...VALUES, username: 'x' }),
    ).toContain(en['updateProfile.usernameTaken']);
  });

  it('has no way out when the tenant owes it, and one when an application asked', () => {
    expect(page()).not.toContain('name="cancel"');
    const requested = renderRequestedUpdateProfilePage(
      'acme',
      ADDRESS,
      'sess-1',
      { fields: FIELDS, values: VALUES },
      [],
      DEFAULT_PAGE_LOCALE,
    ).html;
    expect(requested).toContain('name="cancel"');
    expect(requested).toContain(en['updateProfile.requestedIntro']);
  });

  it('has an Arabic twin for every sentence it uses', () => {
    for (const key of Object.keys(en).filter((each) => each.startsWith('updateProfile.'))) {
      expect(Object.hasOwn(ar, key), key).toBe(true);
    }
  });
});
