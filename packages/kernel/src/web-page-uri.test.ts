import { describe, expect, it } from 'vitest';
import { isLoopbackHost, isValidWebPageUri } from '#/web-page-uri';

describe('isValidWebPageUri', () => {
  it('takes https to any host', () => {
    expect(isValidWebPageUri('https://example.com/terms?lang=en')).toBe(true);
  });

  it('takes http to a loopback host only', () => {
    expect(isValidWebPageUri('http://localhost:3000/terms')).toBe(true);
    expect(isValidWebPageUri('http://127.0.0.1/terms')).toBe(true);
    expect(isValidWebPageUri('http://example.com/terms')).toBe(false);
  });

  it('refuses a fragment, another scheme and text that is no address', () => {
    expect(isValidWebPageUri('https://example.com/terms#top')).toBe(false);
    expect(isValidWebPageUri('javascript:alert(1)')).toBe(false);
    expect(isValidWebPageUri('ftp://example.com/terms')).toBe(false);
    expect(isValidWebPageUri('example.com/terms')).toBe(false);
  });
});

describe('isLoopbackHost', () => {
  it('names the three literal forms', () => {
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('[::1]')).toBe(true);
    expect(isLoopbackHost('example.com')).toBe(false);
  });
});
