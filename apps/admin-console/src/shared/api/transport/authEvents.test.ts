import { describe, expect, it, vi } from 'vitest';
import { createAuthEvents } from '#/shared/api/transport/authEvents';

describe('sessionEvents', () => {
  it('calls every subscriber to authEnded when it is emitted', () => {
    const events = createAuthEvents();
    const first = vi.fn();
    const second = vi.fn();
    events.on('authEnded', first);
    events.on('authEnded', second);

    events.emit('authEnded');

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });

  it('keeps principalChanged subscribers apart from authEnded ones', () => {
    const events = createAuthEvents();
    const ended = vi.fn();
    const changed = vi.fn();
    events.on('authEnded', ended);
    events.on('principalChanged', changed);

    events.emit('principalChanged');

    expect(changed).toHaveBeenCalledOnce();
    expect(ended).not.toHaveBeenCalled();
  });

  it('stops calling a subscriber once it unsubscribes', () => {
    const events = createAuthEvents();
    const listener = vi.fn();
    const off = events.on('authEnded', listener);

    off();
    events.emit('authEnded');

    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps calling the others when one subscriber throws', () => {
    const events = createAuthEvents();
    const after = vi.fn();
    events.on('authEnded', () => {
      throw new Error('a broken subscriber');
    });
    events.on('authEnded', after);

    expect(() => {
      events.emit('authEnded');
    }).toThrow('a broken subscriber');
    expect(after).toHaveBeenCalledOnce();
  });
});
