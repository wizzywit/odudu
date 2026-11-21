import { parseCatalogue, type Catalogue } from '#/services/catalogue';
import { toolOf } from '#/services/catalogue-tool';
import type { RegisteredTool } from '#/services/tool';
import generated from '../mcp-tools.json' with { type: 'json' };

// The tools the package ships: the generated file, read once and checked for
// shape. The server still enforces every call, so a file older than the server
// can refuse a tool but never widen one.
export function loadCatalogue(): Catalogue {
  return parseCatalogue(generated);
}

export function toolsOf(catalogue: Catalogue): RegisteredTool[] {
  return catalogue.tools.map(toolOf);
}
