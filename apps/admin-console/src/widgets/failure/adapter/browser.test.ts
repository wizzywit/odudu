import { afterEach, expect, it, vi } from 'vitest';
import {
  developmentMessageLabel,
  focusMain,
  isDevelopment,
  logError,
  randomBytes,
  reloadPage,
} from '#/widgets/failure/adapter/browser';
import { MESSAGE_LABEL } from '#/widgets/failure/services/wording';

// The browser calls are stubbed with spies: no server answers any of them, so
// there is no transcript body to read a fixture from.
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

it('draws the requested number of bytes from the browser CSPRNG', () => {
  const draw = vi.spyOn(crypto, 'getRandomValues');
  const bytes = randomBytes(8);
  expect(bytes).toBeInstanceOf(Uint8Array);
  expect(bytes).toHaveLength(8);
  expect(draw).toHaveBeenCalledOnce();
});

it('logs the line and the error, and the component stack only when there is one', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const error = new Error('whole');
  logError('a line', error);
  expect(log).toHaveBeenLastCalledWith('a line', error);
  logError('a line', error, 'at Page');
  expect(log).toHaveBeenLastCalledWith('a line', error, 'at Page');
});

it('reloads the window', () => {
  const reload = vi.fn();
  vi.stubGlobal('location', { reload });
  reloadPage();
  expect(reload).toHaveBeenCalledOnce();
});

it('moves focus to the main region, and does nothing where there is none', () => {
  expect(() => {
    focusMain();
  }).not.toThrow();
  const main = document.createElement('main');
  main.id = 'main';
  main.tabIndex = -1;
  document.body.append(main);
  focusMain();
  expect(main).toHaveFocus();
});

it('names the development label and the mode only from the build mode', () => {
  vi.stubEnv('DEV', true);
  expect(isDevelopment()).toBe(true);
  expect(developmentMessageLabel()).toBe(MESSAGE_LABEL);
  vi.stubEnv('DEV', false);
  expect(isDevelopment()).toBe(false);
  expect(developmentMessageLabel()).toBe('');
});
