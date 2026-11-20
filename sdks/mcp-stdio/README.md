# @odudu-io/mcp-stdio

The Odudu admin tools as an MCP server over stdio, for a local MCP client. It
signs in as a person (in their browser) or as a service account, and serves the
tools listed in `src/mcp-tools.json`, a file generated from the server's own
tool definitions. The server enforces every call.

The `./internal` subpath is for the server's own MCP endpoint (`@odudu/mcp`) and
is not API: it is exported as source, is not built or published, and is outside
this package's semver contract.

Licence: Apache-2.0.
