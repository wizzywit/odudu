import type { Role } from '@odudu/contracts/admin';
import { ownerText } from '#/features/roles/service.ts';
import { StatusTag } from '#/shared/view/StatusTag.tsx';

// A client's role reaches a token under its client's name, so it is told
// apart from a tenant role of the same name in words, not by colour.
export function Owner({ role }: { role: Pick<Role, 'client_id' | 'client_key'> }) {
  return <StatusTag tone="neutral">{ownerText(role)}</StatusTag>;
}
