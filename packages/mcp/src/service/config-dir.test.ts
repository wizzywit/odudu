import { describe, expect, it } from 'vitest';
import { configDirectory } from '#/service/config-dir';

describe('where a sign-in is kept', () => {
  it('is under XDG_CONFIG_HOME when that is an absolute path', () => {
    expect(configDirectory({ XDG_CONFIG_HOME: '/x/cfg' }, '/home/a', 'linux')).toBe(
      '/x/cfg/odudu/mcp',
    );
  });

  it.each(['', 'relative/dir', '.', '~/cfg'])('ignores %j and uses ~/.config', (value) => {
    expect(configDirectory({ XDG_CONFIG_HOME: value }, '/home/a', 'linux')).toBe(
      '/home/a/.config/odudu/mcp',
    );
  });

  it('uses ~/.config when it is unset, and APPDATA on Windows when that is absolute', () => {
    expect(configDirectory({}, '/home/a', 'darwin')).toBe('/home/a/.config/odudu/mcp');
    expect(
      configDirectory({ APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'C:\\Users\\a', 'win32'),
    ).toMatch(/AppData.Roaming.odudu.mcp$/u);
    expect(configDirectory({ APPDATA: 'relative' }, '/home/a', 'win32')).toBe(
      '/home/a/.config/odudu/mcp',
    );
  });
});
