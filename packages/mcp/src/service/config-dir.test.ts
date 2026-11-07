import { join, win32 } from 'node:path';
import { describe, expect, it } from 'vitest';
import { configDirectory } from '#/service/config-dir';

describe('where a sign-in is kept', () => {
  it('is under XDG_CONFIG_HOME when that is an absolute path', () => {
    expect(configDirectory({ XDG_CONFIG_HOME: '/x/cfg' }, '/home/a', 'linux')).toBe(
      join('/x/cfg', 'odudu', 'mcp'),
    );
  });

  it.each(['', 'relative/dir', '.', '~/cfg'])('ignores %j and uses ~/.config', (value) => {
    expect(configDirectory({ XDG_CONFIG_HOME: value }, '/home/a', 'linux')).toBe(
      join('/home/a', '.config', 'odudu', 'mcp'),
    );
  });

  it('uses ~/.config when it is unset, and APPDATA on Windows when that is absolute', () => {
    const fallback = join('/home/a', '.config', 'odudu', 'mcp');
    expect(configDirectory({}, '/home/a', 'darwin')).toBe(fallback);
    expect(
      configDirectory({ APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'C:\\Users\\a', 'win32'),
    ).toBe(win32.join('C:\\Users\\a\\AppData\\Roaming', 'odudu', 'mcp'));
    expect(configDirectory({ APPDATA: 'relative' }, '/home/a', 'win32')).toBe(fallback);
  });
});
