-- An unrestricted composite SET NULL nulls tenant_id alongside
-- service_subject_id, so deleting a service subject failed the clients row's
-- own NOT NULL rather than detaching it. The column list (PostgreSQL 15+)
-- nulls only the one column — the same form 0059's two foreign keys use.
ALTER TABLE clients DROP CONSTRAINT clients_service_subject_fk;
ALTER TABLE clients ADD CONSTRAINT clients_service_subject_fk
  FOREIGN KEY (tenant_id, service_subject_id) REFERENCES subjects (tenant_id, id)
  ON DELETE SET NULL (service_subject_id);
