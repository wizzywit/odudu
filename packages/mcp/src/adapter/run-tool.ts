import { execFile } from 'node:child_process';

export type ToolRun =
  | { readonly kind: 'missing' }
  | { readonly kind: 'exit'; readonly code: number; readonly stdout: string };

// Runs an OS tool with its arguments as an argument vector, never a shell
// string, and `input` on its standard input.
export type RunTool = (file: string, args: readonly string[], input?: string) => Promise<ToolRun>;

export const runTool: RunTool = (file, args, input) =>
  new Promise((resolve) => {
    const child = execFile(
      file,
      [...args],
      { timeout: 10_000, maxBuffer: 1_048_576, windowsHide: true },
      (error, stdout) => {
        if (error === null) resolve({ kind: 'exit', code: 0, stdout });
        else if ('code' in error && typeof error.code === 'number') {
          resolve({ kind: 'exit', code: error.code, stdout });
        } else resolve({ kind: 'missing' });
      },
    );
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(input ?? '');
  });
