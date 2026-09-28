import { describe, expect, it, vi } from 'vitest';
import { createSessionEvents } from '#/shared/service/sessionEvents.ts';

describe('sessionEvents', () => {
  it('calls every subscriber to sessionEnded when it is emitted', () => {
    const events = createSessionEvents();
    const first = vi.fn();
    const second = vi.fn();
    events.on('sessionEnded', first);
    events.on('sessionEnded', second);

    events.emit('sessionEnded');

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });

  it('stops calling a subscriber once it unsubscribes', () => {
    const events = createSessionEvents();
    const listener = vi.fn();
    const off = events.on('sessionEnded', listener);

    off();
    events.emit('sessionEnded');

    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps calling the others when one subscriber throws', () => {
    const events = createSessionEvents();
    const after = vi.fn();
    events.on('sessionEnded', () => {
      throw new Error('a broken subscriber');
    });
    events.on('sessionEnded', after);

    expect(() => {
      events.emit('sessionEnded');
    }).toThrow('a broken subscriber');
    expect(after).toHaveBeenCalledOnce();
  });
});
