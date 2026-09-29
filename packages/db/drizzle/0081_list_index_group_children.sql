-- One level of the group tree, `GET …/groups?parent=`, in id order: without
-- this each level reads every group in the tenant to find a parent's children.
CREATE INDEX groups_by_parent ON groups (tenant_id, parent_id, id);
