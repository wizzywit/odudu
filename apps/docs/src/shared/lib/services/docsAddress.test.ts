import { describe, expect, it } from 'vitest';
import { DOCS_DIRECTORY } from '@site/site.config';
import { docsAddress, docsRouteOf } from '@site/src/shared/lib/services/docsAddress';

describe('docsAddress', () => {
  it('puts a route under the docs directory the build serves from', () => {
    expect(docsAddress(DOCS_DIRECTORY, '/guides/')).toBe(`/${DOCS_DIRECTORY}guides/`);
    expect(docsAddress(DOCS_DIRECTORY, 'guides/')).toBe(`/${DOCS_DIRECTORY}guides/`);
    expect(docsAddress(DOCS_DIRECTORY, '/roadmap/#next')).toBe(`/${DOCS_DIRECTORY}roadmap/#next`);
  });

  it('leaves a route where it is when the build serves the docs from its root', () => {
    expect(docsAddress('', '/guides/')).toBe('/guides/');
  });
});

describe('docsRouteOf', () => {
  it('reads the docs route the configuration names', () => {
    expect(docsRouteOf({ docsRoute: DOCS_DIRECTORY })).toBe(DOCS_DIRECTORY);
    expect(docsRouteOf({ docsRoute: '' })).toBe('');
  });

  it('refuses a configuration that names none', () => {
    expect(() => docsRouteOf({})).toThrow(/docsRoute/u);
    expect(() => docsRouteOf(undefined)).toThrow(/docsRoute/u);
  });
});
