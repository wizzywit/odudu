import { describe, expect, it } from 'vitest';
import { createBrowserOpener } from '#/adapter/browser';
import type { RunTool, ToolRun } from '#/adapter/run-tool';

function recorder(result: ToolRun = { kind: 'exit', code: 0, stdout: '' }) {
  const calls: { file: string; args: readonly string[]; input: string | undefined }[] = [];
  const run: RunTool = (file, args, input) => {
    calls.push({ file, args, input });
    return Promise.resolve(result);
  };
  return { calls, run };
}

const URL_WITH_SHELL_CHARACTERS = 'https://id.example.com/auth?x=1&y=$(touch /tmp/x);`id`|a';

describe('opening the browser', () => {
  it.each([
    ['darwin', 'open', [URL_WITH_SHELL_CHARACTERS]],
    ['linux', 'xdg-open', [URL_WITH_SHELL_CHARACTERS]],
    ['win32', 'rundll32', ['url.dll,FileProtocolHandler', URL_WITH_SHELL_CHARACTERS]],
  ] as const)(
    'on %s runs %s with the address as one argument, not a shell string',
    async (platform, file, args) => {
      const r = recorder();
      expect(await createBrowserOpener(platform, r.run)(URL_WITH_SHELL_CHARACTERS)).toBe(true);
      expect(r.calls).toEqual([{ file, args, input: undefined }]);
    },
  );

  it('reports false when the tool is missing or fails, so the caller can print the address', async () => {
    expect(
      await createBrowserOpener('linux', recorder({ kind: 'missing' }).run)('https://a.example/'),
    ).toBe(false);
    expect(
      await createBrowserOpener(
        'linux',
        recorder({ kind: 'exit', code: 3, stdout: '' }).run,
      )('https://a.example/'),
    ).toBe(false);
  });

  it('opens nothing that is not an http or https address', async () => {
    const r = recorder();
    const open = createBrowserOpener('darwin', r.run);
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', '--help', 'x', 'ssh://host']) {
      expect(await open(url), url).toBe(false);
    }
    expect(r.calls).toEqual([]);
  });

  it('has no command on a platform it does not know', async () => {
    const r = recorder();
    expect(await createBrowserOpener('aix', r.run)('https://a.example/')).toBe(false);
    expect(r.calls).toEqual([]);
  });
});
