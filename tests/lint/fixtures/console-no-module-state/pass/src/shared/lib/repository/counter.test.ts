let calls = 0;
const seen: string[] = [];

export function note(name: string): void {
  calls += 1;
  seen.push(name);
}
