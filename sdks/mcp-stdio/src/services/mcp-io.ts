import type { Readable, Writable } from 'node:stream';
import type { RunTool } from '#/services/ports';

export interface McpIo {
  readonly stdin: Readable;
  // Protocol only: every line a person should read goes to `stderr`.
  readonly stdout: Writable;
  readonly stderr: (line: string) => void;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly platform: NodeJS.Platform;
  // Where a sign-in is kept when the operating system has no store for it.
  readonly configDir: string;
  readonly run: RunTool;
  readonly fetch: typeof fetch;
  readonly now: () => Date;
  readonly entropy: (bytes: number) => Uint8Array;
  // How the person ran the command, for the failure lines and the commands the
  // messages tell them to type: `odudu-mcp` for the package's command, `odudu mcp`
  // for the server's. `odudu mcp` when omitted.
  readonly command?: string;
  readonly openBrowser?: (url: string) => Promise<boolean>;
}
