import { expect, it, vi } from 'vitest';
import { askAssistant } from '#/entities/assistant/adapter/askAssistant';
import { listenForTask } from '#/entities/assistant/adapter/taskEvent';
import { askedFor } from '#/entities/assistant/services/taskRequest';

const ASK = { tenant: 'acme', profile: 'review-client', draft: 'Review.' };

it('reaches a listening gate, and a task asked with none listening goes nowhere', () => {
  askAssistant(ASK);
  const heard = vi.fn<(detail: typeof ASK) => void>();
  const stop = listenForTask(heard);
  askAssistant(ASK);
  expect(heard).toHaveBeenCalledWith(ASK);
  stop();
  askAssistant(ASK);
  expect(heard).toHaveBeenCalledTimes(1);
});

it('reads a task for its own tenant only', () => {
  expect(askedFor(ASK, 'acme')).toEqual(ASK);
  expect(askedFor(ASK, 'demo')).toBeNull();
});
