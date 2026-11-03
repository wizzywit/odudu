import { cleanup } from '@testing-library/react';
import { useDialogHost } from '#/shared/lib/repository/useDialogHost';
import { useDrafts } from '#/shared/lib/repository/useDrafts';
import { useToasts } from '#/shared/lib/repository/useToasts';
import { useUnsavedGuard } from '#/shared/lib/repository/useUnsavedGuard';

// The stores outlive a render. Whatever is mounted comes down first: a dialog
// closing after the reset would take the host's count below zero.
export function resetConsole(): void {
  cleanup();
  useToasts.setState(useToasts.getInitialState(), true);
  useDialogHost.setState(useDialogHost.getInitialState(), true);
  useUnsavedGuard.setState(useUnsavedGuard.getInitialState(), true);
  useDrafts.getState().reset();
}
