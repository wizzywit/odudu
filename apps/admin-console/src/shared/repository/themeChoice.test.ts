import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadThemeChoice } from '#/shared/adapter/themeChoice.ts';
import { applyRememberedTheme, rememberThemeChoice } from '#/shared/repository/themeChoice.ts';

const root = document.documentElement;

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  delete root.dataset.theme;
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
});
