import { describe, expect, it } from 'vitest';
import { PAGE_CONTEXT_PART, pageContextText, readPageContext } from '#/service/page-context';

describe('the page context', () => {
  it('reads what was stored and nothing else', () => {
    const stored = [
      {
        type: PAGE_CONTEXT_PART,
        data: { route: '/clients', objectType: 'client', objectId: 'web' },
      },
    ];
    expect(readPageContext(stored)).toEqual({
      route: '/clients',
      objectType: 'client',
      objectId: 'web',
    });
    expect(readPageContext([{ type: 'text', text: 'hi' }])).toBeNull();
    expect(readPageContext([{ type: PAGE_CONTEXT_PART, data: { route: 'no slash' } }])).toBeNull();
    expect(
      readPageContext([{ type: PAGE_CONTEXT_PART, data: { route: '/a', note: 'extra' } }]),
    ).toBeNull();
    expect(readPageContext('x')).toBeNull();
    expect(readPageContext([])).toBeNull();
  });

  it('puts the page in words, and says nothing without one', () => {
    expect(pageContextText(null)).toBe('');
    expect(pageContextText({ route: '/clients' })).toBe(
      'The administrator has the console page /clients open.',
    );
    expect(pageContextText({ route: '/clients', objectType: 'client', objectId: 'web' })).toBe(
      'The administrator has the console page /clients open. It shows the client web.',
    );
  });

  it('names an object only when it has both a type and an id', () => {
    expect(pageContextText({ route: '/clients', objectType: 'client' })).not.toContain('shows');
    expect(pageContextText({ route: '/clients', objectId: 'web' })).not.toContain('shows');
  });
});
