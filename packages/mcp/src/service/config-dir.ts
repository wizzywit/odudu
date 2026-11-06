import { isAbsolute, join, win32 } from 'node:path';

// Where a sign-in is kept when the operating system has no store for it. A
// base that is empty or not an absolute path is ignored, as the XDG Base
// Directory specification asks: it would otherwise name the working directory,
// which may be a repository.
export function configDirectory(
  env: Readonly<Record<string, string | undefined>>,
  home: string,
  platform: NodeJS.Platform,
): string {
  const windows = platform === 'win32';
  const candidate = windows ? env.APPDATA : env.XDG_CONFIG_HOME;
  const absolute = (value: string | undefined): value is string =>
    value !== undefined && value !== '' && (windows ? win32.isAbsolute(value) : isAbsolute(value));
  const base = absolute(candidate) ? candidate : join(home, '.config');
  return (windows && absolute(candidate) ? win32.join : join)(base, 'odudu', 'mcp');
}
