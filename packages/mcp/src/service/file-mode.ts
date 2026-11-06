const GROUP_AND_OTHERS = 0o077;

// A credential is the user's alone: any permission bit for group or others
// refuses the file, whatever it holds.
export function fileModeProblem(mode: number, kind: 'file' | 'directory'): string | undefined {
  if ((mode & GROUP_AND_OTHERS) === 0) return undefined;
  const bits = (mode & 0o777).toString(8);
  return kind === 'file'
    ? `is readable by group or others (mode ${bits})`
    : `is accessible to group or others (mode ${bits})`;
}

// A directory whose entries could be replaced by anyone but the user: a
// sticky bit does not excuse it, since it only protects entries from other
// users that are not the directory's own.
export function writableProblem(mode: number): string | undefined {
  if ((mode & 0o022) === 0) return undefined;
  return `is writable by group or others (mode ${(mode & 0o7777).toString(8)})`;
}
