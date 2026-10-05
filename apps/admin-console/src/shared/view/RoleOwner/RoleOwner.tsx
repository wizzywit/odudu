import { roleOwnerText } from '#/shared/service/capabilities.ts';
import { StatusTag } from '#/shared/view/StatusTag';

// Told apart in words, not by colour, wherever a role is listed.
export function RoleOwner({
  role,
}: {
  role: { client_id: string | null; client_key: string | null };
}) {
  return <StatusTag tone="neutral">{roleOwnerText(role)}</StatusTag>;
}
