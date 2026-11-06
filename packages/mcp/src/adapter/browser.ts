import type { RunTool } from '#/adapter/run-tool';

export type OpenUrl = (url: string) => Promise<boolean>;

function commandFor(platform: NodeJS.Platform, url: string): [string, string[]] | null {
  if (platform === 'darwin') return ['open', [url]];
  if (platform === 'linux') return ['xdg-open', [url]];
  if (platform === 'win32') return ['rundll32', ['url.dll,FileProtocolHandler', url]];
  return null;
}

// Asks the desktop to open an address, with the address as one argument of the
// platform's own command and no shell in between. Only http and https are ever
// opened. Whether it worked is a boolean: a caller that gets false prints the
// address for the person to open themselves.
export function createBrowserOpener(platform: NodeJS.Platform, run: RunTool): OpenUrl {
  return async (url) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    const command = commandFor(platform, url);
    if (command === null) return false;
    const result = await run(command[0], command[1]);
    return result.kind === 'exit' && result.code === 0;
  };
}
