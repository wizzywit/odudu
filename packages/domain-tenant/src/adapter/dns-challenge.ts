import { resolveTxt } from 'node:dns/promises';
import { type ResolveTxt } from '#/service/tenant-domain';

export const DEFAULT_LOOKUP_TIMEOUT_MS = 5000;

export interface DnsChallengeOptions {
  timeoutMs?: number;
  lookup?: (name: string) => Promise<string[][]>;
}

// The one place the system resolver is reached. A lookup that outlives its
// timeout rejects, which the usecase reads as indeterminate.
export function dnsChallengeResolver(options: DnsChallengeOptions = {}): ResolveTxt {
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOOKUP_TIMEOUT_MS;
  const lookup = options.lookup ?? resolveTxt;
  return async (name) => {
    let timer: NodeJS.Timeout | undefined;
    const expired = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`DNS lookup of ${name} timed out`));
      }, timeoutMs);
    });
    try {
      return await Promise.race([lookup(name), expired]);
    } finally {
      clearTimeout(timer);
    }
  };
}
