import { execFile } from 'node:child_process';
import type { RunTool, ToolRun } from '#/service/ports';

export type { RunTool, ToolRun };

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
