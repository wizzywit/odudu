import { expect, it, vi } from 'vitest';
import { reportDefect } from '#/shared/lib/platform/report';

it('writes the message to the browser console', () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  reportDefect('console defect: x');
  expect(spy).toHaveBeenCalledWith('console defect: x');
  spy.mockRestore();
});
