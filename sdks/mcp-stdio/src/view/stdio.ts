import type { McpServer } from '@modelcontextprotocol/server';
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import type { Readable, Writable } from 'node:stream';

export interface StdioDeps {
  // The server for the connection, made once the client has chosen its era.
  readonly server: () => McpServer;
  readonly stdin: Readable;
  // Nothing but protocol is ever written here; a person's messages go to standard error.
  readonly stdout: Writable;
  readonly onerror: (error: Error) => void;
}

export interface StdioConnection {
  // Settles when the client closes its end of the pipe, or on `close`.
  readonly closed: Promise<void>;
  close(): Promise<void>;
}

// Serves MCP over a pair of streams, the process's own standard input and
// output in the command. The SDK's transport frames each message as one JSON
// line and ends when input does, as the stdio binding asks of a server.
export function serveMcpStdio(deps: StdioDeps): StdioConnection {
  let finish: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => {
    finish = resolve;
    deps.stdin.once('end', resolve);
    deps.stdin.once('close', resolve);
  });
  const handle = serveStdio(deps.server, {
    transport: new StdioServerTransport(deps.stdin, deps.stdout),
    onerror: deps.onerror,
  });
  return {
    closed,
    close: async () => {
      await handle.close();
      finish();
    },
  };
}
