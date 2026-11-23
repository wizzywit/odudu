import { readFile, stat } from 'node:fs/promises';
import { fileModeProblem } from '#/services/file-mode';
import { StdioError } from '#/services/stdio-error';

// The service account key in a file only its owner can read, as `ssh` asks of
// a private key.
export async function readKeyFile(file: string, platform: NodeJS.Platform): Promise<string> {
  const info = await stat(file).catch(() => null);
  if (info === null) {
    throw new StdioError('mcp_invalid_options', `--key-file ${file} cannot be read`);
  }
  const problem = platform === 'win32' ? undefined : fileModeProblem(info.mode, 'file');
  if (problem !== undefined) {
    throw new StdioError(
      'mcp_store_insecure',
      `the key file ${file} ${problem}; fix it with chmod 600`,
    );
  }
  return (await readFile(file, 'utf8')).trim();
}
