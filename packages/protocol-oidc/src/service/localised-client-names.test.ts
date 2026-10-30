import { describe, expect, it } from 'vitest';
import { parseLocalisedClientNames } from '#/service/localised-client-names';

const SUPPORTED = ['en', 'fr', 'pt-BR'];

describe('parseLocalisedClientNames', () => {
  it('reads client_name#fr, the RFC 7591 §2.2 form', () => {
    expect(
      parseLocalisedClientNames({ client_name: 'App', 'client_name#fr': 'Appli' }, SUPPORTED),
    ).toEqual({ kind: 'ok', names: { fr: 'Appli' } });
  });

  it('spells a tag canonically', () => {
    expect(parseLocalisedClientNames({ 'client_name#pt-br': 'Aplicativo' }, SUPPORTED)).toEqual({
      kind: 'ok',
      names: { 'pt-BR': 'Aplicativo' },
    });
  });

  it('ignores a language the tenant does not offer', () => {
    expect(parseLocalisedClientNames({ 'client_name#ja': 'アプリ' }, SUPPORTED)).toEqual({
      kind: 'ok',
      names: {},
    });
  });

  it('ignores other members that merely look alike', () => {
    expect(
      parseLocalisedClientNames(
        { 'client_uri#fr': 'https://x', 'client_namex#fr': 'a', 'x_client_name#fr': 'b' },
        SUPPORTED,
      ),
    ).toEqual({ kind: 'ok', names: {} });
  });

  it.each([
    'client_name#<script>alert(1)</script>',
    'client_name#',
    'client_name#fr_FR',
    'client_name#__proto__',
    'client_name#' + 'a'.repeat(200),
    'client_name#fr#de',
  ])('refuses the member %j', (member) => {
    const outcome = parseLocalisedClientNames({ [member]: 'x' }, SUPPORTED);
    expect(outcome).toMatchObject({ kind: 'invalid' });
  });

  it('does not repeat a hostile tag in its refusal', () => {
    const outcome = parseLocalisedClientNames({ 'client_name#<script>': 'x' }, SUPPORTED);
    expect(JSON.stringify(outcome)).not.toContain('<script>');
  });

  it('refuses one tag spelled two ways', () => {
    const outcome = parseLocalisedClientNames(
      { 'client_name#pt-br': 'a', 'client_name#pt-BR': 'b' },
      SUPPORTED,
    );
    expect(outcome).toMatchObject({ kind: 'invalid' });
  });

  it('refuses an unoffered tag written twice, as it does an offered one', () => {
    const outcome = parseLocalisedClientNames(
      { 'client_name#DE': 'a', 'client_name#de': 'b' },
      SUPPORTED,
    );
    expect(outcome).toMatchObject({ kind: 'invalid' });
  });

  it('reads no other language-tagged member', () => {
    expect(
      parseLocalisedClientNames(
        {
          'client_uri#fr': 'https://x',
          'logo_uri#fr': 'https://y',
          'policy_uri#fr': 'z',
          'tos_uri#fr': 'w',
        },
        SUPPORTED,
      ),
    ).toEqual({ kind: 'ok', names: {} });
  });

  it.each([1, null, '', ['a'], {}, 'a‮b', 'x'.repeat(257)])('refuses the value %j', (value) => {
    expect(parseLocalisedClientNames({ 'client_name#fr': value }, SUPPORTED)).toMatchObject({
      kind: 'invalid',
    });
  });

  it('refuses more than 32 localised members, in or out of the list', () => {
    const body = Object.fromEntries(
      Array.from({ length: 33 }, (_, i) => [`client_name#x${String.fromCharCode(97 + i)}`, 'a']),
    );
    expect(parseLocalisedClientNames(body, SUPPORTED)).toMatchObject({ kind: 'invalid' });
  });
});
