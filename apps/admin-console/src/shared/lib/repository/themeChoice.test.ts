import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadThemeChoice } from '#/shared/api/adapter/themeChoice';
import { applyRememberedTheme, rememberThemeChoice } from '#/shared/lib/repository/themeChoice';

const root = document.documentElement;

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  delete root.dataset.theme;
  document.cookie = 'odudu-theme=; Path=/; Max-Age=0';
});

describe('the remembered theme', () => {
  it('follows the system until a theme is chosen', () => {
    expect(loadThemeChoice()).toBe('system');
    applyRememberedTheme();
    expect(root.dataset.theme).toBeUndefined();
  });

  it('remembers a chosen theme and names it on <html>', () => {
    rememberThemeChoice('dark');
    expect(root.dataset.theme).toBe('dark');
    delete root.dataset.theme;
    expect(loadThemeChoice()).toBe('dark');
    applyRememberedTheme();
    expect(root.dataset.theme).toBe('dark');
  });

  it('forgets the override when the system is chosen again', () => {
    rememberThemeChoice('light');
    rememberThemeChoice('system');
    expect(root.dataset.theme).toBeUndefined();
    expect(loadThemeChoice()).toBe('system');
  });

  it('ignores a stored value it does not recognise', () => {
    localStorage.setItem('odudu.console.theme', 'sepia');
    expect(loadThemeChoice()).toBe('system');
  });

  it('still themes the page when storage refuses every access', () => {
    const refuse = (): never => {
      throw new DOMException('denied', 'SecurityError');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(refuse);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(refuse);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(refuse);
    expect(loadThemeChoice()).toBe('system');
    expect(() => {
      rememberThemeChoice('dark');
    }).not.toThrow();
    expect(root.dataset.theme).toBe('dark');
    expect(() => {
      rememberThemeChoice('system');
    }).not.toThrow();
    expect(root.dataset.theme).toBeUndefined();
  });

  it('survives a window whose localStorage getter itself throws', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(loadThemeChoice()).toBe('system');
    expect(() => {
      rememberThemeChoice('light');
    }).not.toThrow();
    expect(root.dataset.theme).toBe('light');
  });

  it('hands the choice to the server-rendered pages as a cookie', () => {
    rememberThemeChoice('dark');
    expect(document.cookie).toContain('odudu-theme=dark');
    rememberThemeChoice('system');
    expect(document.cookie).not.toContain('odudu-theme');
  });

  it('gives a returning user the cookie on start without picking again', () => {
    localStorage.setItem('odudu.console.theme', 'light');
    expect(document.cookie).not.toContain('odudu-theme');
    applyRememberedTheme();
    expect(document.cookie).toContain('odudu-theme=light');
  });

  it('removes a cookie left behind when the remembered choice is the system', () => {
    document.cookie = 'odudu-theme=dark; Path=/';
    applyRememberedTheme();
    expect(document.cookie).not.toContain('odudu-theme');
  });

  it('keeps a cookie written earlier when storage cannot be read at start', () => {
    document.cookie = 'odudu-theme=dark; Path=/';
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    applyRememberedTheme();
    expect(document.cookie).toContain('odudu-theme=dark');
    expect(root.dataset.theme).toBeUndefined();
  });
});
