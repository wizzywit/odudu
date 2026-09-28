import { expect, it } from 'vitest';
import { useDialogHost } from '#/shared/repository/useDialogHost.ts';

it('counts each open dialog once, however often it reports closing', () => {
  const first = useDialogHost.getState().opened();
  const second = useDialogHost.getState().opened();
  expect(useDialogHost.getState().open).toBe(2);
  first();
  first();
  expect(useDialogHost.getState().open).toBe(1);
  second();
  expect(useDialogHost.getState().open).toBe(0);
});
