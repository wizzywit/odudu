// An MCP client that starts `odudu-mcp`, Odudu's admin tools as an MCP server
// over standard input and output, signs in as a service account with its key,
// and calls a tool. The key is a secret: keep it in your platform's secret
// store and hand it to the command in its environment, never in its arguments.
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const transport = new StdioClientTransport({
  command: 'npx',
  args: [
    'odudu-mcp',
    // The address is accepted over http because it is a loopback address.
    ...['--base-url', process.env.ODUDU_BASE ?? 'http://localhost:3000'],
    ...['--tenant', process.env.TENANT ?? 'demo'],
    ...['--client-id', process.env.ODUDU_MCP_CLIENT_ID ?? 'example-mcp'],
  ],
  env: { PATH: process.env.PATH ?? '', ODUDU_MCP_KEY: process.env.ODUDU_MCP_KEY ?? '' },
  // What the command says about a failure goes to this terminal.
  stderr: 'inherit',
});

const client = new Client({ name: 'odudu-example-mcp', version: '0.0.0' });
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  console.log(`tools: ${tools.map((tool) => tool.name).join(' ')}`);
  const clients = await client.callTool({ name: 'list_clients', arguments: {} });
  console.log(`list_clients: ${JSON.stringify(clients.structuredContent)}`);
} catch (error) {
  console.error(String(error));
  process.exitCode = 1;
} finally {
  await client.close();
}
