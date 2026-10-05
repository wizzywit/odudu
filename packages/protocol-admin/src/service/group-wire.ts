import { type GroupFields } from '@odudu/contracts/admin';

export function groupWireShape(group: {
  id: string;
  name: string;
  description: string | null;
  parentId: string | null;
  defaultForNewSubjects: boolean;
  path: string;
  createdAt: Date;
}): GroupFields {
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    parent_id: group.parentId,
    default_for_new_subjects: group.defaultForNewSubjects,
    path: group.path,
    created_at: group.createdAt.toISOString(),
  };
}
