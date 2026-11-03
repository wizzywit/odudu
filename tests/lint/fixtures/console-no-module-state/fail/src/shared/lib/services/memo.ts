export function counter() {
  let n: number | undefined;
  return () => {
    n = (n ?? 0) + 1;
    return n;
  };
}

export function twoSlots() {
  let a: number | null = null;
  let b: number | null = null;
  return () => {
    a = (b ?? 0) + 1;
    b = a;
    return a;
  };
}

export function collects() {
  let seen: Set<string> | null = null;
  return (item: string) => {
    seen = (seen ?? new Set<string>()).add(item);
    return seen;
  };
}

export function holder() {
  let current: string | null = null;
  return {
    set: (value: string) => {
      current = value;
    },
    get: () => current,
  };
}

export const a = counter();
export const b = twoSlots();
export const c = collects();
export const d = holder();
