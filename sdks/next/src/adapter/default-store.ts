import { createMemoryStore, type SessionStore } from '@odudu-io/bff';
import {
  DEFAULT_STORE_WARNING,
  DEFAULT_STORE_WARNING_CODE,
  shouldWarnAboutDefaultStore,
} from '#/services/default-store-warning';
import { splitStore } from '#/services/split-store';

const REGISTRY = Symbol.for('@odudu-io/next/default-stores');
const WARNED = Symbol.for('@odudu-io/next/default-store-warned');
// A login cookie lives ten minutes; a record unused that long is dead.
const LOGIN_IDLE_MS = 10 * 60 * 1000;

type Registry = Map<string, SessionStore>;

// The in-memory store of one BFF configuration, one per process. A Next build
// gives each route and each page its own copy of every module they import,
// so a store made when a module loads would be a different store in the
// route handler that signs a person in and in the server component that reads
// them. The process is the one thing they share, so the store is kept on it.
// The registry holds one entry per distinct configuration an app declares.
export function defaultStore(key: string, now: () => number): SessionStore {
  warnOnce();
  const holder = globalThis as { [REGISTRY]?: Registry };
  const registry: Registry = holder[REGISTRY] ?? new Map<string, SessionStore>();
  holder[REGISTRY] = registry;
  const found = registry.get(key);
  if (found !== undefined) return found;
  const made = splitStore(
    createMemoryStore({ now }),
    createMemoryStore({ idleMs: LOGIN_IDLE_MS, now }),
  );
  registry.set(key, made);
  return made;
}

function warnOnce(): void {
  const holder = globalThis as { [WARNED]?: boolean };
  if (!shouldWarnAboutDefaultStore(process.env.NODE_ENV, holder[WARNED] === true)) return;
  holder[WARNED] = true;
  process.emitWarning(DEFAULT_STORE_WARNING, { code: DEFAULT_STORE_WARNING_CODE });
}
