import type { MappedRole } from '#/shared/services/mappedRoles';
import { recordTab } from '#/shared/ui/RecordTab';
import { RoleOwner } from '#/shared/ui/RoleOwner';

// The roles a group or a scope hands on, each told apart by whose it is.
export function MappedRoles({
  name,
  mapped,
  empty,
}: {
  name: string;
  mapped: readonly MappedRole[];
  // What to say when none is mapped, in place of the plain statement.
  empty?: string;
}) {
  if (mapped.length === 0) {
    return <p className={recordTab.rule}>{empty ?? `${name} carries no role.`}</p>;
  }
  return (
    <ul aria-label={`Carried by ${name}`} className={recordTab.items}>
      {mapped.map((role) => (
        <li key={role.id}>
          <code>{role.name}</code> <RoleOwner role={role} />
          {role.description === null || role.description === '' ? null : (
            <span className={recordTab.rule}>{` ${role.description}`}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
