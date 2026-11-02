export const LIMITS = { name: 64, description: 500 } as const;
export const ORDER = ['read', 'write', 'admin'] as const;
export const TONES = Object.freeze({ success: 'ok', error: 'bad' });
export const SAFE = /^[a-z]+$/u;
const SENDERS = new Set(['fetch', 'send']);
const EMPTY: string[] = [];
const labels = { a: 'A', b: 'B' };

export function isSender(name: string): boolean {
  return SENDERS.has(name) && EMPTY.length === 0 && labels.a !== name;
}
