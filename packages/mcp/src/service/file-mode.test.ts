import { describe, expect, it } from 'vitest';
import { fileModeProblem, writableProblem } from '#/service/file-mode';

describe('the mode a credential file may have', () => {
  it.each([0o600, 0o400, 0o700])('accepts %o', (mode) => {
    expect(fileModeProblem(mode, 'file')).toBeUndefined();
  });

  it.each([0o644, 0o640, 0o604, 0o660, 0o666, 0o777, 0o601])('refuses %o', (mode) => {
    expect(fileModeProblem(mode, 'file')).toMatch(/group or others/u);
  });

  it('reads only the permission bits, not the file type', () => {
    expect(fileModeProblem(0o100600, 'file')).toBeUndefined();
    expect(fileModeProblem(0o100644, 'file')).toMatch(/group or others/u);
  });

  it('holds a directory to the same rule', () => {
    expect(fileModeProblem(0o755, 'directory')).toMatch(/accessible to group or others/u);
  });

  it('refuses a parent that group or others can write to, sticky or not, and not one they can only read', () => {
    expect(writableProblem(0o755)).toBeUndefined();
    expect(writableProblem(0o700)).toBeUndefined();
    expect(writableProblem(0o770)).toMatch(/writable by group or others/u);
    expect(writableProblem(0o707)).toMatch(/writable by group or others/u);
    expect(writableProblem(0o41777)).toMatch(/writable by group or others/u);
  });
});
