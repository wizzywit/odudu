const GROUP_AND_OTHERS = 0o077;

// A credential is the user's alone: any permission bit for group or others
// refuses the file, whatever it holds.
export function fileModeProblem(mode: number, kind: 'file' | 'directory'): string | undefined {
  if ((mode & GROUP_AND_OTHERS) === 0) return undefined;
  const bits = (mode & 0o777).toString(8);
  return kind === 'file'
    ? `is readable by group or others (mode ${bits})`
    : `directory is accessible to group or others (mode ${bits})`;
}
