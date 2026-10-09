-- Whether an administrator may rename a subject's username through
-- PATCH /admin/tenants/{tenant}/subjects/{id}. Off by default, so a tenant
-- does not start accepting renames because it was upgraded (ADR 0039).
ALTER TABLE tenants ADD COLUMN username_editable boolean NOT NULL DEFAULT false;
