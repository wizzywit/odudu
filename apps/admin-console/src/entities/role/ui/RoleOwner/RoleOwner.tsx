import { StatusTag } from '#/shared/ui/StatusTag';
import { roleOwnerTag } from '#/entities/role/use-cases/roleOption';

// Told apart in words, not by colour, wherever a role is listed.
export function RoleOwner({
  role,
}: {
  role: { client_id: string | null; client_key: string | null };
}) {
  return <StatusTag tone="neutral">{roleOwnerTag(role)}</StatusTag>;
}
