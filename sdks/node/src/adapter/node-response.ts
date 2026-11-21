import type { Refusal } from '#/services/refusal';

// What the adapters need of a Node response, which Express's extends.
export interface NodeResponse {
  statusCode: number;
  headersSent: boolean;
  setHeader: (name: string, value: string) => unknown;
  end: (body?: string) => unknown;
}

export function sendRefusal(res: NodeResponse, refusal: Refusal): void {
  res.statusCode = refusal.status;
  for (const [name, value] of Object.entries(refusal.headers)) res.setHeader(name, value);
  res.end(refusal.body);
}
