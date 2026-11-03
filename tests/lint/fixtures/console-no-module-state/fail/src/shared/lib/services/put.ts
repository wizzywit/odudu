import { cache, log as entries, settings } from './cache';

export function put(key: string): void {
  cache.set(key, 1);
  entries.push(key);
  settings.depth += 1;
}
