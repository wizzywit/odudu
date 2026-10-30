import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Consent and required-action pages need a signed-in session to reach, so the
// registrations that serve them are held to handing on the resolver by
// reading the composition; apps/server drives the routes that can be reached.
describe('the composition hands the branding resolver to every route that renders a page', () => {
  it('spreads it into authorize, consent, logout and the shared login submission', async () => {
    const text = await readFile(path.join(import.meta.dirname, 'index.ts'), 'utf8');
    // A comment that names the spread must not stand in for it.
    const source = text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');
    const block = (start: string): string => {
      const at = source.indexOf(start);
      expect(at, start).toBeGreaterThan(-1);
      return source.slice(at, source.indexOf('\n    });', at));
    };
    for (const start of [
      'registerAuthorizeRoute(app, {',
      'registerConsentRoute(app, {',
      'registerLogoutRoute(app, {',
      'const loginSubmission = {',
    ]) {
      expect(block(start), start).toContain('...branding');
    }
    expect(block('registerRequiredActionRoute(app, {')).toContain('...loginSubmission');
    expect(block('registerLoginRoute(app, {')).toContain('...loginSubmission');
  });
});
