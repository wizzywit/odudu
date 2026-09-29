import { type Group } from '@odudu/contracts/admin';

export function groupWireShape(group: {
  id: string;
  name: string;
  parentId: string | null;
  path: string;
  createdAt: Date;
}): Group {
  return {
    id: group.id,
    name: group.name,
    parent_id: group.parentId,
    path: group.path,
    created_at: group.createdAt.toISOString(),
  };
}
