const seen = new Set<string>();
const same = seen;
const pending = new Map<string, number>();
const { set } = pending;
const names = [] satisfies string[];
const typed = <Set<string>>new Set();
const fresh = new Array<string>();
const copy = Array.from([1]);
const pushed: string[] = [];
const quiet: string[] = [];
const target = { a: 1 };

export function mutate(): void {
  same.add('a');
  set('a', 1);
  names['push']('a');
  typed.add('b');
  fresh.push('c');
  copy.push(2);
  Array.prototype.push.call(pushed, 'd');
  quiet?.push('e');
  [target.a] = [2];
}
