import { createEvents } from './events';

export function useThing() {
  let current = 0;
  const events = createEvents();
  current += 1;
  return { events, current };
}
