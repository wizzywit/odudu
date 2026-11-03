import { expect, it, vi } from 'vitest';
import { createBrowserTransport } from '#/shared/transport/transport';

it('gives each transport its own session events, so a listener of one never hears another', () => {
  const first = createBrowserTransport();
  const second = createBrowserTransport();
  const heard = vi.fn();
  first.events.on('authEnded', heard);
  second.events.emit('authEnded');
  expect(heard).not.toHaveBeenCalled();
  first.events.emit('authEnded');
  expect(heard).toHaveBeenCalledOnce();
});
